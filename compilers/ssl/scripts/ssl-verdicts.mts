/**
 * Records what THIS front end does with every corpus script, so a change can be checked against a
 * baseline in about a minute, with no reference process involved.
 *
 * The corpus differential answers "do we still match the reference", and pays for the reference process
 * per script to do it. A front-end refactor asks a narrower question - "does the set of scripts I accept,
 * the reason I refuse the rest, and the bytes I emit for the ones I take, all still match what they were
 * before I started" - and that needs no reference at all. Dropping it turns a long sweep into an
 * in-process one.
 *
 * That is the gate the multi-error work needs: converting a throw into a recorded diagnostic must not
 * change which scripts compile, what the first message says, or a single emitted byte. This measures
 * exactly those three and nothing else.
 *
 * Usage: pnpm ssl-verdicts --save <file>   sweep and write a baseline
 *        pnpm ssl-verdicts --check <file>  sweep and report every difference from one (exit 1 if any)
 *   --levels 0,1,2   optimisation levels to sweep (default all three)
 *
 * `SSL_CORPUS_ONLY=<stem>` and `SSL_CORPUS_LIMIT=<n>` narrow the sweep for debugging, exactly as they do
 * for the test suites.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../src/compile.ts";
import { preprocess } from "../src/preprocess.ts";
import { narrow, scriptsUnder } from "../test/integration/corpus-files.ts";

// Anchored to this file rather than to cwd. The repo's shared `repo-root` helper reads `__dirname`, which
// an ES module does not have, so it cannot be imported here - `ssl-diff.mts` computes its own for the
// same reason.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");
const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");

type Level = 0 | 1 | 2;

function usage(message: string): never {
    console.error(`${message}\n\nUsage: pnpm ssl-verdicts --save <file> | --check <file> [--levels 0,1,2]`);
    process.exit(2);
}

function parseArgs(argv: string[]) {
    let mode: "save" | "check" | null = null;
    let file: string | null = null;
    let levels: Level[] = [0, 1, 2];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--save" || arg === "--check") {
            mode = arg.slice(2) as "save" | "check";
            file = argv[++i] ?? usage(`${arg} needs a file`);
        } else if (arg === "--levels") {
            const raw = argv[++i] ?? usage("--levels needs a list like 0,2");
            levels = raw.split(",").map((part) => {
                if (!/^[012]$/.test(part)) usage(`bad level '${part}'`);
                return Number(part) as Level;
            });
        } else {
            usage(`unknown option '${arg}'`);
        }
    }
    if (mode === null || file === null) usage("give --save <file> or --check <file>");
    return { mode, file, levels };
}

/**
 * The Restoration Project alone, narrowed by the same switches the suites use.
 *
 * Deliberately NARROWER than the suites, which also sweep FO2tweaks and Party_Orders: those only
 * preprocess once their dependencies' headers are linked into their trees, which the suites' `globalSetup`
 * does and this cannot reach - it lives in a module that resolves paths through `__dirname`, and this is an
 * ES module. Sweeping them from here would report all 28 as refused and bury a real change in the noise.
 * What this answers - "did anything about my own front end move" - is served by the 1500 either way.
 */
function listScripts(): string[] {
    const scripts = narrow(scriptsUnder(RP_SCRIPTS));
    if (scripts.length === 0) {
        console.error(`No corpus at ${path.relative(REPO_ROOT, RP_SCRIPTS)} - run pnpm test:external first.`);
        process.exit(2);
    }
    return scripts;
}

/**
 * What the front end did, as one line. Accepted scripts carry a digest rather than a length: the point is
 * to catch a change in the bytes, and equal-length-but-different is exactly the change a length would miss.
 * Absolute paths are stripped so a baseline diffs cleanly and does not carry this machine's layout.
 */
function verdict(parser: Parser, script: string, level: Level): string {
    try {
        const bytes = compileText(parser, preprocess(script), { level });
        return `ok ${createHash("sha1").update(bytes).digest("hex").slice(0, 12)}`;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `refused ${message.replaceAll(`${REPO_ROOT}/`, "").replaceAll(/\s+/g, " ").trim()}`;
    }
}

async function sweep(levels: Level[]): Promise<Map<string, string>> {
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

    const scripts = listScripts();
    const verdicts = new Map<string, string>();
    for (const script of scripts) {
        const stem = path.basename(script, path.extname(script));
        for (const level of levels) verdicts.set(`${stem}\t-O${level}`, verdict(parser, script, level));
    }
    console.error(`swept ${scripts.length} scripts at ${levels.map((l) => `-O${l}`).join(", ")}`);
    return verdicts;
}

function serialize(verdicts: Map<string, string>): string {
    return [...verdicts].map(([key, value]) => `${key}\t${value}`).join("\n") + "\n";
}

function parseBaseline(text: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const parts = line.split("\t");
        const value = parts.pop();
        if (value === undefined) continue;
        out.set(parts.join("\t"), value);
    }
    return out;
}

/** Groups differences by what actually changed, since the three mean very different things. */
function report(before: Map<string, string>, after: Map<string, string>): number {
    const nowRefused: string[] = [];
    const nowAccepted: string[] = [];
    const messageChanged: string[] = [];
    const bytesChanged: string[] = [];
    const missing: string[] = [];

    for (const [key, was] of before) {
        const now = after.get(key);
        if (now === undefined) {
            missing.push(key);
        } else if (now === was) {
            continue;
        } else if (was.startsWith("ok") && now.startsWith("refused")) {
            nowRefused.push(`${key}: ${now}`);
        } else if (was.startsWith("refused") && now.startsWith("ok")) {
            nowAccepted.push(`${key}: was ${was}`);
        } else if (was.startsWith("ok")) {
            bytesChanged.push(`${key}: ${was} -> ${now}`);
        } else {
            messageChanged.push(`${key}:\n    was ${was}\n    now ${now}`);
        }
    }
    const added = [...after.keys()].filter((key) => !before.has(key));

    const groups: [string, string[]][] = [
        ["now REFUSED (was accepted)", nowRefused],
        ["now ACCEPTED (was refused)", nowAccepted],
        ["BYTES changed", bytesChanged],
        ["first MESSAGE changed", messageChanged],
        ["absent from this sweep", missing],
        ["not in the baseline", added],
    ];
    let total = 0;
    for (const [title, entries] of groups) {
        if (entries.length === 0) continue;
        total += entries.length;
        console.log(`\n${title}: ${entries.length}`);
        for (const entry of entries.slice(0, 20)) console.log(`  ${entry}`);
        if (entries.length > 20) console.log(`  ... and ${entries.length - 20} more`);
    }
    if (total === 0) console.log(`identical: ${after.size} verdicts unchanged`);
    return total;
}

async function main(): Promise<number> {
    const args = parseArgs(process.argv.slice(2));
    const verdicts = await sweep(args.levels);

    if (args.mode === "save") {
        fs.writeFileSync(args.file, serialize(verdicts));
        console.log(`wrote ${verdicts.size} verdicts to ${args.file}`);
        return 0;
    }
    if (!fs.existsSync(args.file)) usage(`no baseline at ${args.file} - run --save first`);
    return report(parseBaseline(fs.readFileSync(args.file, "utf8")), verdicts) === 0 ? 0 : 1;
}

process.exit(await main());
