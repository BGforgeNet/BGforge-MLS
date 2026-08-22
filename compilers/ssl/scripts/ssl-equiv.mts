/**
 * Checks that a repo's modified .ssl files still compile to the same bytecode as their committed
 * versions, at every optimisation level.
 *
 * This is the gate for the TSSL transpiler's generated output: its text is allowed to drift (comments,
 * spacing, literal spelling), but what the mod actually ships is the compiled script, so equivalence is
 * measured where it matters - the .int bytes. An allow-listed file is one whose divergence is a VERIFIED
 * correctness fix over the committed baseline (the allow-list lives with its reasons in the caller);
 * such a file must still compile cleanly on the new side, it is just not required to match bytes the old
 * pipeline got wrong.
 *
 * Usage: pnpm ssl-equiv <repo-dir> [--allow <basename>]...
 *   Compares `git show HEAD:<file>` against the worktree for every modified .ssl under the repo.
 *   Exit 1 on any unexcused divergence, either side failing to compile, or an unused --allow entry
 *   (a stale exception is an implied all-clear nobody is checking).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { compilePreprocessed, type CompileOptions } from "../src/compile.ts";
import { preprocessTextWithOrigins } from "../src/preprocess.ts";

// Anchored to this file rather than to cwd; the shared `repo-root` helper reads `__dirname`, which an ES
// module does not have - `ssl-diff.mts` computes its own for the same reason.
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const WASM_DIR = path.join(REPO_ROOT, "server/out");

const LEVELS = [0, 1, 2] as const;

function usage(message: string): never {
    console.error(`${message}\nUsage: pnpm ssl-equiv <repo-dir> [--allow <basename>]...`);
    process.exit(1);
}

function git(repo: string, ...args: string[]): string {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf-8", timeout: 60_000 });
}

function main(): void {
    const args = process.argv.slice(2);
    const allow = new Set<string>();
    let repo: string | undefined;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--allow") {
            const name = args[++i];
            if (!name) usage("--allow needs a file name");
            allow.add(name);
        } else if (repo === undefined) {
            repo = args[i];
        } else {
            usage(`unexpected argument '${args[i]}'`);
        }
    }
    if (!repo) usage("missing repo directory");
    if (!fs.existsSync(path.join(WASM_DIR, "tree-sitter-ssl.wasm"))) {
        usage("grammar not built - run: pnpm build:grammar");
    }
    void run(path.resolve(repo), allow);
}

async function run(repo: string, allow: Set<string>): Promise<void> {
    await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
    const parser = new Parser();
    parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));

    const changed = git(repo, "diff", "--name-only", "--", "*.ssl").split("\n").filter(Boolean);
    const allowUsed = new Set<string>();
    let equivalent = 0;
    let excused = 0;
    let failures = 0;

    /** Compiles one text as the file at `entry`; a refusal comes back as its message. */
    const compile = (text: string, entry: string, level: (typeof LEVELS)[number]): Uint8Array | string => {
        const options: CompileOptions = { level };
        try {
            return compilePreprocessed(parser, preprocessTextWithOrigins(text, entry), entry, options);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    };

    for (const file of changed) {
        const entry = path.join(repo, file);
        const oldText = git(repo, "show", `HEAD:${file}`);
        const newText = fs.readFileSync(entry, "utf-8");
        const excusable = allow.has(path.basename(file));
        const problems: string[] = [];
        let diverged = false;
        for (const level of LEVELS) {
            const oldBytes = compile(oldText, entry, level);
            const newBytes = compile(newText, entry, level);
            // The committed side must compile too: a baseline that never compiled cannot excuse anything.
            if (typeof oldBytes === "string") problems.push(`-O${level} committed side refused: ${oldBytes}`);
            if (typeof newBytes === "string") problems.push(`-O${level} new side refused: ${newBytes}`);
            if (typeof oldBytes === "string" || typeof newBytes === "string") continue;
            if (Buffer.compare(oldBytes, newBytes) !== 0) diverged = true;
        }
        if (problems.length > 0) {
            failures++;
            console.error(`FAIL ${file}\n  ${problems.join("\n  ")}`);
        } else if (!diverged) {
            equivalent++;
        } else if (excusable) {
            excused++;
            allowUsed.add(path.basename(file));
            console.log(`excused ${file} (allow-listed divergence)`);
        } else {
            failures++;
            console.error(`FAIL ${file}: compiled bytes differ from the committed version`);
        }
    }

    // A stale exception outlives the divergence it excused and silently widens the gate.
    for (const name of allow) {
        if (!allowUsed.has(name)) {
            failures++;
            console.error(`FAIL --allow ${name}: no modified .ssl diverged under that name; drop the entry`);
        }
    }

    console.log(`${changed.length} modified .ssl: ${equivalent} equivalent, ${excused} excused, ${failures} failures`);
    process.exit(failures > 0 ? 1 : 0);
}

main();
