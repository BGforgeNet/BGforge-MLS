/**
 * Regenerates the committed corpus oracle manifest by running the live differential.
 *
 * This is the old 16-minute sweep wearing a --save flag: every corpus script is preprocessed once, the
 * bundled compiler compiles it at -O0/-O1/-O2 in a child process, ours compiles the same text in-process,
 * and the two are byte-compared before the digest is recorded - so a regeneration cannot bake a
 * divergence into the manifest. The integration sweeps then compare against the manifest alone, which is
 * what removed the ~4500 child processes from the routine gate.
 *
 * Run after bumping the compiler dependency, bumping a corpus pin in external/fallout.txt, or changing
 * preprocessor behaviour: pnpm ssl-oracles
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../src/compile.ts";
import { preprocess } from "../src/preprocess.ts";
import { CORPUS_SIZE, corpusKey, isGenerated, listScripts, referenceDigest } from "../test/integration/corpus.ts";
import linkHeaders from "../test/integration/global-setup.ts";
import {
    LEVELS,
    MANIFEST_PATH,
    currentPins,
    formatManifest,
    sha256,
    type OracleDigest,
    type OracleManifest,
} from "../test/integration/oracle-manifest.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

async function main(): Promise<void> {
    const compiler = createRequire(path.join(REPO_ROOT, "server/package.json")).resolve(
        "sslc-emscripten-noderawfs/compiler.mjs",
    );
    if (!fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"))) {
        console.error("grammar not built - run: pnpm build:grammar");
        process.exit(1);
    }
    // Read the pins BEFORE the sweep: they are written at the end, and a pin that fails to read after
    // sixteen minutes of child processes wastes exactly that long (it happened - the compiler dependency
    // sat in a section the reader did not look in).
    const pins = currentPins();

    // The other mods' scripts only preprocess once the headers they borrow are linked into place - the
    // same setup the integration suites get from vitest.
    const unlinkHeaders = linkHeaders();

    const scripts = listScripts();
    if (scripts.length !== CORPUS_SIZE) {
        console.error(
            `corpus holds ${scripts.length} scripts, expected ${CORPUS_SIZE} - reset external repos first, ` +
                `then run scripts/generate-external-ssl.sh`,
        );
        process.exit(1);
    }

    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssl-oracles-"));
    const entries: OracleManifest["entries"] = new Map();
    const divergences: string[] = [];
    let refusals = 0;
    let done = 0;

    try {
        for (const script of scripts) {
            // Its text moves with the TSSL compiler, not with a pin, so the sweeps run the reference on it live.
            if (isGenerated(script)) continue;
            const key = corpusKey(script);
            const stem = path.basename(script, path.extname(script));
            const digests: OracleDigest[] = [];
            let text: string | null = null;
            try {
                text = preprocess(script);
                fs.writeFileSync(path.join(workDir, `${stem}.ssl`), text);
            } catch {
                // A script our preprocessor refuses yields no oracle at any level; the sweep's pinned
                // exclusion lists are what decide whether that is acceptable.
                text = null;
            }
            for (const level of LEVELS) {
                if (text === null) {
                    digests.push("refused");
                    continue;
                }
                // A killed child throws rather than returning a refusal: recording it would poison the
                // manifest with a refusal the compiler never made.
                const expected = referenceDigest(compiler, workDir, stem, level);
                digests.push(expected);
                if (expected === "refused") {
                    refusals++;
                    continue;
                }
                // A regeneration is a full live differential: ours must reproduce every oracle recorded.
                try {
                    const actual = compileText(parser, text, { level });
                    if (sha256(actual) !== expected) divergences.push(`${key} -O${level}: bytes differ`);
                } catch (error) {
                    divergences.push(`${key} -O${level}: ours refused: ${(error as Error).message}`);
                }
            }
            entries.set(key, digests as [OracleDigest, OracleDigest, OracleDigest]);
            done++;
            if (done % 100 === 0) console.log(`${done}/${scripts.length}`);
        }
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
        unlinkHeaders();
    }

    if (divergences.length > 0) {
        console.error(`REFUSING to write the manifest: ours diverges from the live compiler on:`);
        for (const line of divergences.slice(0, 20)) console.error(`  ${line}`);
        process.exit(1);
    }

    fs.writeFileSync(
        MANIFEST_PATH,
        formatManifest({ compilerPin: pins.compilerPin, corpusPins: pins.corpusPins, entries }),
    );
    console.log(
        `${entries.size} scripts recorded (${refusals} level-refusals) to ${path.relative(REPO_ROOT, MANIFEST_PATH)}`,
    );
}

await main();
