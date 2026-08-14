/**
 * The Restoration Project script corpus, shared by the suites that sweep it.
 *
 * The size is pinned because the corpus is not stable while the test suite runs: `scripts/test-external.sh`
 * deletes every path in `external/fallout-exclude.txt` for the duration of its own run and restores them
 * from git in an EXIT trap. Forty-two of those are scripts under `scripts_src`, so anything reading the
 * corpus inside that window silently sweeps a smaller set - the counts all stay plausible and every gate
 * measured against them quietly weakens. Asserting the size turns that into a named failure.
 *
 * Raise `CORPUS_SIZE` when the pinned external checkout genuinely grows; never lower it to accommodate a
 * run that saw fewer, which is the symptom this exists to catch.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";

export const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");

export const CORPUS_SIZE = 1525;

/**
 * Narrows the sweep for DEBUGGING only - `SSL_CORPUS_ONLY=gcskeetr` for one script by stem,
 * `SSL_CORPUS_LIMIT=250` for the first N. Each of these suites spawns the reference compiler once per
 * script and takes minutes, which is the wrong loop to iterate a fix against; the subset reproduces in
 * seconds and the full sweep is the confirmation.
 *
 * A narrowed run cannot pass: `CORPUS_SIZE` is asserted by every suite here, so a subset fails on the
 * population check before reporting a verdict. That is deliberate - the switch is for reading the
 * report, never for getting to green.
 */
function narrow(scripts: string[]): string[] {
    const only = process.env.SSL_CORPUS_ONLY;
    if (only) return scripts.filter((s) => path.basename(s, path.extname(s)) === only);
    const limit = Number(process.env.SSL_CORPUS_LIMIT ?? 0);
    return limit > 0 ? scripts.slice(0, limit) : scripts;
}

/**
 * How many times a KILLED reference invocation is retried before its script is counted as excluded.
 *
 * The bundled compiler wedges roughly one spawn in several thousand, on a script it otherwise compiles in
 * under a tenth of a second - `scgond` and later `dcpengrd` (177 lines) each hit the two-minute bound and
 * then compiled in milliseconds when run alone. Two, not one: on 2026-08-14 `dcpengrd` hung on the retry
 * as well, which reddened a sweep whose 1521 other oracles all matched.
 */
const KILL_RETRIES = 2;

/** What the reference said when it refused a script, and how it ended. */
export class ReferenceRefusedError extends Error {
    readonly why: string;
    readonly said: readonly string[];

    constructor(why: string, said: readonly string[]) {
        super(`${why}: ${said.at(-1) ?? "silent"}`);
        this.name = "ReferenceRefusedError";
        this.why = why;
        this.said = said;
    }

    /** The last real error line, which is the one worth reporting; the banner above it is noise. */
    get reason(): string {
        return this.said.findLast((line) => line.includes("[Error]")) ?? this.said.at(-1) ?? "silent";
    }
}

/**
 * One reference invocation against `<stem>.ssl` in `cwd`, retried while the child is KILLED rather than
 * exiting. A real rejection exits with a status and is never retried, so a pinned exclusion list still
 * fails loudly when the reference genuinely refuses a script.
 */
export function runReference(compiler: string, cwd: string, stem: string, level: number): void {
    const args = [compiler, `-O${level}`, "-q", `${stem}.ssl`, "-o", `${stem}.int`];
    for (let attempt = 0; ; attempt++) {
        try {
            execFileSync(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"], timeout: SPAWN_TIMEOUT_MS });
            return;
        } catch (error) {
            const { status, signal, stdout, stderr } = error as {
                status?: number;
                signal?: string;
                stdout?: Buffer;
                stderr?: Buffer;
            };
            if (signal !== undefined && attempt < KILL_RETRIES) continue;
            // Diagnostics come back on STDOUT, not stderr, so both are read or the refusal reports as a
            // bare exit code.
            const said = `${stdout?.toString() ?? ""}${stderr?.toString() ?? ""}`
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => !line.startsWith("[Warning]") && !line.startsWith("***"));
            throw new ReferenceRefusedError(signal ? `killed by ${signal}` : `exit ${status ?? "?"}`, said);
        }
    }
}

/** Every corpus script, sorted. `template` holds deliberately malformed inputs; `sfall` is a header symlink. */
export function listScripts(): string[] {
    if (!fs.existsSync(RP_SCRIPTS)) return [];
    const out: string[] = [];
    for (const entry of fs.readdirSync(RP_SCRIPTS)) {
        if (entry === "template" || entry === "sfall") continue;
        const dir = path.join(RP_SCRIPTS, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const file of fs.readdirSync(dir)) {
            if (file.toLowerCase().endsWith(".ssl")) out.push(path.join(dir, file));
        }
    }
    return narrow(out.sort());
}
