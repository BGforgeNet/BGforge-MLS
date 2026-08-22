/**
 * The TSSL bytecode oracle: for every `.tssl` in a mod repo, the digest of the INT bytes its transpiled
 * SSL compiles to, under each switch set the manifest names.
 *
 * This is the gate that survives a mod dropping its generated `.ssl`. `ssl-equiv` measures the same
 * property - the transpiler still produces something that compiles to the bytes it used to - by
 * comparing the worktree's `.ssl` against `git show HEAD:`, so it needs a committed `.ssl` baseline and
 * fails open the moment there is not one. Digesting the bytecode instead keeps the property and drops
 * the dependency on an intermediate file, which is what lets the intermediate stop existing.
 *
 * Usage: pnpm tssl-oracles <repo-dir> [--update]
 *   Default checks the committed manifest and exits 1 on any divergence. `--update` rewrites it.
 *
 * **The pinning is deliberately the INVERSE of `reference-oracles.txt`, and confusing the two would make
 * this gate useless.** That manifest pins the compiler it was generated against, because the compiler is
 * an external dependency whose bump silently invalidates every digest. Here the transpiler and the
 * compiler are both ours and both under test: their output changing is the event the gate exists to
 * report, so pinning them would turn every regression into a "regenerate" prompt. Only the corpus is
 * pinned - a corpus bump moves the inputs and genuinely does call for regeneration - and updating the
 * digests is an explicit reviewed act, never something a source change licenses.
 *
 * The switch sets are recorded in the manifest rather than hardcoded here, so the coverage is reviewable
 * and widening it shows up as a diff. `-O0/-O1/-O2` carry over from `ssl-equiv`; `-O2 -s` is what mods
 * actually ship, and short-circuit evaluation is otherwise exercised only by unit tests over hand-built
 * programs - no corpus sweep compiles a real script with it.
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { compilePreprocessed, type CompileOptions } from "../src/compile.ts";
import { preprocessTextWithOrigins } from "../src/preprocess.ts";
import { createBatchState, transpile } from "../../tssl/src/index.ts";
import { setConlog } from "../../tssl/src/types.ts";

// Anchored to this file rather than to cwd; the shared `repo-root` helper reads `__dirname`, which an ES
// module does not have - the sibling `ssl-equiv.mts` computes its own for the same reason.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");
const MANIFEST_PATH = path.join(REPO_ROOT, "compilers/ssl/test/integration/tssl-int-oracles.txt");
const CORPUS_PINS = path.join(REPO_ROOT, "external/fallout.txt");

/** One switch set, as it would be written on the command line. Parsed back into `CompileOptions`. */
type SwitchSet = string;

const DEFAULT_SWITCHES: SwitchSet[] = ["-O0", "-O1", "-O2", "-O2 -s"];

const HEADER = [
    "# TSSL bytecode oracles: sha256 of the INT bytes each .tssl transpiles-and-compiles to, per switch",
    "# set, or 'refused'. Regenerate deliberately with: pnpm tssl-oracles <repo> --update",
    "# Only the corpus is pinned. The transpiler and compiler are under test here, so a digest that moves",
    "# is a finding to review, never a prompt to regenerate.",
].join("\n");

interface Manifest {
    /** Verbatim `<url> <sha>` line for the repo these oracles were generated from. */
    corpusPin: string;
    switches: SwitchSet[];
    /** Repo-relative `.tssl` path to one digest per switch set. */
    entries: Map<string, string[]>;
}

function usage(message: string): never {
    console.error(`${message}\nUsage: pnpm tssl-oracles <repo-dir> [--update]`);
    process.exit(1);
}

function git(repo: string, ...args: string[]): string {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf-8", timeout: 60_000 });
}

/** `-O2 -s` to `{ level: 2, shortCircuit: true }`. Refuses anything unrecognised rather than ignoring it. */
function optionsOf(switches: SwitchSet): CompileOptions {
    const options: CompileOptions = {};
    for (const token of switches.split(/\s+/).filter(Boolean)) {
        switch (token) {
            case "-O0":
                options.level = 0;
                break;
            case "-O1":
                options.level = 1;
                break;
            case "-O2":
                options.level = 2;
                break;
            case "-s":
                options.shortCircuit = true;
                break;
            default:
                // Silently dropping one would make the manifest describe coverage it does not have.
                throw new Error(`unrecognised switch '${token}' in switch set '${switches}'`);
        }
    }
    return options;
}

function formatManifest(manifest: Manifest): string {
    const lines = [HEADER, `corpus ${manifest.corpusPin}`];
    for (const set of manifest.switches) lines.push(`switches ${set}`);
    for (const [script, digests] of [...manifest.entries].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${script} ${digests.join(" ")}`);
    }
    return `${lines.join("\n")}\n`;
}

function parseManifest(text: string): Manifest {
    let corpusPin = "";
    const switches: SwitchSet[] = [];
    const entries: Manifest["entries"] = new Map();
    for (const line of text.split("\n")) {
        if (line === "" || line.startsWith("#")) continue;
        const fields = line.split(" ");
        if (fields[0] === "corpus") {
            corpusPin = fields.slice(1).join(" ");
        } else if (fields[0] === "switches") {
            switches.push(fields.slice(1).join(" "));
        } else if (fields.length === switches.length + 1) {
            entries.set(fields[0] as string, fields.slice(1));
        } else {
            // A dropped line silently shrinks the comparison while every count stays plausible.
            throw new Error(`malformed manifest line: ${line}`);
        }
    }
    if (switches.length === 0) throw new Error("manifest names no switch sets");
    return { corpusPin, switches, entries };
}

/** The pinned `<url> <sha>` line for the repo, so a corpus bump reads as "regenerate", not "regression". */
function corpusPinOf(repo: string): string {
    const name = path.basename(repo);
    const lines = fs
        .readFileSync(CORPUS_PINS, "utf-8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));
    const line = lines.find((candidate) => candidate.split(/\s+/)[0]?.endsWith(`/${name}`) === true);
    if (line === undefined) throw new Error(`'${name}' is not pinned in ${path.relative(REPO_ROOT, CORPUS_PINS)}`);
    return line.replaceAll(/\s+/g, " ");
}

async function digestRepo(repo: string, switches: SwitchSet[]): Promise<Map<string, string[]>> {
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

    const sources = git(repo, "ls-files", "*.tssl").split("\n").filter(Boolean).sort();
    if (sources.length === 0) throw new Error(`no tracked .tssl under ${repo}`);

    // Per-file progress chatter, not diagnostics - a refusal throws and is reported below, so silencing
    // this leaves the gate's output as its verdict.
    setConlog(() => {});
    // One ts-morph project across the repo: a fresh one per file re-parses the TypeScript default library.
    const batch = createBatchState();
    const options = switches.map((set) => optionsOf(set));
    const entries = new Map<string, string[]>();

    for (const source of sources) {
        const filePath = path.join(repo, source);
        // The generated SSL is never written; the .ssl name only positions diagnostics.
        const entry = filePath.replace(/\.tssl$/, ".ssl");
        let ssl: string;
        try {
            // Sequential by necessity: the batch state is one ts-morph project, and each file is
            // registered into it under an overwriting shadow name, so concurrent transpiles clobber
            // each other's entry source.
            // eslint-disable-next-line no-await-in-loop -- see above
            ssl = await transpile(filePath, fs.readFileSync(filePath, "utf-8"), batch);
        } catch (error) {
            entries.set(
                source,
                switches.map(() => "refused"),
            );
            console.error(`  ${source}: transpile refused: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        entries.set(
            source,
            options.map((option) => {
                try {
                    const bytes = compilePreprocessed(parser, preprocessTextWithOrigins(ssl, entry), entry, option);
                    return createHash("sha256").update(bytes).digest("hex");
                } catch {
                    return "refused";
                }
            }),
        );
    }
    return entries;
}

/**
 * The committed manifest, or `null` when there is none. Read rather than probed first: a check leaves a
 * window in which the file can go away before the read.
 */
function readCommittedManifest(): Manifest | null {
    try {
        return parseManifest(fs.readFileSync(MANIFEST_PATH, "utf-8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

async function run(repo: string, update: boolean): Promise<void> {
    const corpusPin = corpusPinOf(repo);
    const committed = readCommittedManifest();
    if (committed === null && !update) {
        console.error(`FAIL: no manifest at ${path.relative(REPO_ROOT, MANIFEST_PATH)}; generate it with --update`);
        process.exit(1);
    }
    const switches = committed?.switches ?? DEFAULT_SWITCHES;
    const entries = await digestRepo(repo, switches);

    if (update) {
        fs.writeFileSync(MANIFEST_PATH, formatManifest({ corpusPin, switches, entries }), "utf-8");
        console.log(
            `wrote ${entries.size} entries x ${switches.length} switch sets to ${path.relative(REPO_ROOT, MANIFEST_PATH)}`,
        );
        return;
    }

    const manifest = committed as Manifest;
    const failures: string[] = [];
    if (manifest.corpusPin !== corpusPin) {
        // Named as staleness rather than as a regression: the inputs moved, so the digests are expected to.
        failures.push(
            `corpus pin moved since the manifest was generated - regenerate:\n    was ${manifest.corpusPin}\n    now ${corpusPin}`,
        );
    }
    for (const [script, digests] of entries) {
        const expected = manifest.entries.get(script);
        if (expected === undefined) {
            failures.push(`${script}: not in the manifest - a new script needs its oracles recorded`);
            continue;
        }
        for (const [i, digest] of digests.entries()) {
            if (digest !== expected[i]) {
                failures.push(`${script} (${manifest.switches[i]}): ${expected[i]} -> ${digest}`);
            }
        }
    }
    // A script that vanished shrinks the gate silently; every count below it still looks healthy.
    for (const script of manifest.entries.keys()) {
        if (!entries.has(script)) failures.push(`${script}: in the manifest but no longer in the repo`);
    }

    if (failures.length > 0) {
        console.error(`FAIL: ${failures.length} divergence(s) from the committed oracles`);
        for (const failure of failures) console.error(`  ${failure}`);
        process.exit(1);
    }
    console.log(`${entries.size} scripts x ${switches.length} switch sets match the committed oracles`);
}

function main(): void {
    const args = process.argv.slice(2);
    let repo: string | undefined;
    let update = false;
    for (const arg of args) {
        if (arg === "--update") {
            update = true;
        } else if (repo === undefined) {
            repo = arg;
        } else {
            usage(`unexpected argument '${arg}'`);
        }
    }
    if (!repo) usage("missing repo directory");
    if (!fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"))) {
        usage("grammar not built - run: pnpm build:grammar");
    }
    void run(path.resolve(repo), update);
}

main();
