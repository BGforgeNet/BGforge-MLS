/**
 * The script corpus the differential sweeps - the Restoration Project plus the other pinned mods - shared
 * by the suites that read it.
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
import * as path from "node:path";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { SPAWN_TIMEOUT_MS } from "../../../../shared/spawn-timeout.ts";
import { narrow, scriptsIn, scriptsUnder } from "./corpus-files.ts";

export const RP_SCRIPTS = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/scripts_src");

const FALLOUT = path.join(REPO_ROOT, "external/fallout");

/**
 * The other pinned mods' scripts. Twenty-eight against RP's fifteen hundred, and worth more than that
 * ratio suggests: a corpus of one mod is a corpus of one house style, and three defects found by first
 * compiling these - a negated parameter default, a map keyed by a PID constant, an argument list split
 * across lines - are ordinary code that no RP script happens to contain. Neither preprocesses until the
 * headers they borrow from each other are linked into place, which `global-setup.ts` does.
 *
 * `source_test` under FO2tweaks is left out: the mod's own build compiles `source` alone, so those are
 * scratch files rather than something it ships.
 */
const OTHER_SCRIPTS = [path.join(FALLOUT, "FO2tweaks/source"), path.join(FALLOUT, "Fallout2_Party_Orders/source")];

export const CORPUS_SIZE = 1553;

/**
 * Corpus scripts that do not compile, and what is wrong with each. Every one is a defect in the mod's own
 * source, in one of two shapes: a procedure declared and never defined, or a reference to a symbol that
 * does not exist.
 *
 * Both sweeps exclude them, and both pin this same list - the compile differential because the REFERENCE
 * refuses them, the decompile sweep because THIS front end does. That the two sets are identical is the
 * intended state and the reason they share one constant: a script the reference will not build is one we
 * must not build either, or we ship bytecode for source it considers broken. When the lists last diverged,
 * the declare-but-never-define scripts compiled here into procedures with empty bodies - every call to one
 * silently doing nothing at runtime.
 *
 * Pinned by name rather than counted, because this set is the denominator every gate is measured against:
 * a script leaving it silently shrinks the comparison while every count still looks healthy. `waypnt`
 * appears twice because two corpus directories each hold a file of that name, and both are broken.
 */
export const BROKEN_SCRIPTS: readonly {
    readonly stem: string;
    /**
     * Which defect, because it decides whether OPTIMISING makes the script build. An undefined procedure
     * is a code-generation error only while the procedure survives: it is unreferenced, so `-O1` removes
     * it before anything asks for its body and the script then compiles. An undefined symbol is read by
     * live code, and no amount of dead-code elimination makes it go away.
     */
    readonly defect: "undefined-procedure" | "undefined-symbol";
    readonly reason: string;
}[] = [
    { stem: "epa1", defect: "undefined-procedure", reason: "declares doRepostion, never defines it" },
    { stem: "epa2", defect: "undefined-procedure", reason: "declares doRepostion, never defines it" },
    { stem: "gl_k_modini", defect: "undefined-procedure", reason: "declares force_settings, never defines it" },
    { stem: "gl_p_party_orders", defect: "undefined-procedure", reason: "declares loot_n_drop, never defines it" },
    { stem: "hcmale", defect: "undefined-procedure", reason: "declares Node002, never defines it" },
    { stem: "vcconnar", defect: "undefined-procedure", reason: "declares Node040, never defines it" },
    { stem: "waypnt", defect: "undefined-symbol", reason: "reads self_tile, which is not defined" },
    { stem: "waypnt", defect: "undefined-symbol", reason: "reads self_tile, which is not defined" },
    { stem: "zccorpse", defect: "undefined-symbol", reason: "reads SCRIPT_ZCCORPSE, which is not defined" },
];

/** Just the names, sorted - the shape a sweep's own exclusion list is compared against. */
export const BROKEN_STEMS: readonly string[] = BROKEN_SCRIPTS.map((script) => script.stem).toSorted();

/** The subset still broken once optimising, which is what the `-O1`/`-O2` sweep excludes. */
export const BROKEN_WHEN_OPTIMISED: readonly string[] = BROKEN_SCRIPTS.filter(
    (script) => script.defect === "undefined-symbol",
)
    .map((script) => script.stem)
    .toSorted();

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

/** Every corpus script, sorted, narrowed by the debugging switches. */
export function listScripts(): string[] {
    return narrow([...scriptsUnder(RP_SCRIPTS), ...OTHER_SCRIPTS.flatMap((dir) => scriptsIn(dir))]);
}
