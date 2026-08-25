/**
 * Differential: the built-in BAF compiler (Task 3) against the real WeiDU binary, over the full external
 * corpus. Round-trip byte-identity is unavailable here because the input is source, not a compiled artifact,
 * so the oracle is WeiDU's own accept/refuse verdict, and the corpus is partitioned by what each half can
 * prove:
 *   - self-contained files: both compilers see everything they need, so a disagreement is a real defect.
 *   - install-gated files (a `%variable%` or `@strref` only a tp2 install resolves): the built-in compiler
 *     is expected to refuse, naming the construct - see `REFUSALS` in `../../src/weidu-baf/compiler.ts`.
 *
 * The oracle needs a real installed game rather than `--nogame`: measured across 40 self-contained corpus
 * files, `--nogame` rejected 36 that a real install accepts and accepted none it did not, because WeiDU
 * reports its own missing naming tables as `Parsing.Parse_error`, indistinguishable from a real syntax
 * error. Both sides of the differential read the SAME install (BGFORGE_IE_GAME) so a construct the install's
 * edition lacks is refused by both sides - agreement, not a false disagreement.
 *
 * Skips cleanly when WeiDU or a game install is unavailable, the way the corpus suites skip on an
 * unchecked-out external/. This never runs in CI: game data is not redistributable, so there is no install
 * to point BGFORGE_IE_GAME at there. Set it to a local install to run this suite.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import { pathToFileURL } from "url";
import { beforeAll, describe, expect, it } from "vitest";
import * as fg from "fast-glob";
import { openGame } from "@bgforge/binary/archive";
import { compileBafText } from "../../src/weidu-baf/compiler";
import { compileSymbolsFrom } from "../../../compilers/bcs/src/index";
import { bcsEngineForScriptStyle } from "../../../shared/bcs-engine";
import { initParser, getParser } from "../../../shared/parsers/weidu-baf";
import { IE_FIXTURES } from "./test-helpers";

/** An installed IE game directory whose tables both compilers read. Unset means "skip", not "use --nogame". */
const GAME = process.env.BGFORGE_IE_GAME;

/** `scripts/ensure-weidu.sh` resolves a pinned WeiDU and exports this; both test scripts already call it. */
const WEIDU = process.env.WEIDU_BIN ?? "weidu";

/** WeiDU exits 4 on a genuine parse failure. Anything else it throws for is not a verdict, so it is reported. */
const WEIDU_PARSE_ERROR = 4;

/** A synchronous spawn without an explicit timeout cannot be interrupted by vitest's own timeout. */
const WEIDU_TIMEOUT_MS = 15000;

/** A `%variable%` (assigned by a tp2 during install) or an `@strref` (allocated when a translation is added). */
const SUBSTITUTION = /%[A-Za-z_][A-Za-z0-9_]*%|@\d+/;

/** Mirrors `compilers/bcs/test/weidu-differential.test.ts`'s own guard: skip cleanly, never fail confusingly. */
function weiduAvailable(): boolean {
    try {
        execFileSync(WEIDU, ["--version"], { timeout: WEIDU_TIMEOUT_MS, stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
}

const available = weiduAvailable();
const files = fg.sync("**/*.baf", { cwd: IE_FIXTURES, absolute: true, caseSensitiveMatch: false }).sort();
const selfContained = files.filter((f) => !SUBSTITUTION.test(fs.readFileSync(f, "utf8")));
const needsInstall = files.filter((f) => SUBSTITUTION.test(fs.readFileSync(f, "utf8")));

describe.skipIf(files.length === 0 || !GAME || !available)("built-in BAF compiler vs the reference", () => {
    let opts: (file: string) => Parameters<typeof compileBafText>[0];

    beforeAll(async () => {
        await initParser();
        const parser = getParser();
        // Built ONCE from the same install WeiDU reads, not per file: a `Game` opens archives and caches
        // table lookups, and this suite compiles hundreds of files.
        const game = openGame(GAME!, { mode: "engine" });
        const symbols = compileSymbolsFrom(game);
        const engine = bcsEngineForScriptStyle(game.identity.scriptStyle);
        opts = (file) => ({
            text: fs.readFileSync(file, "utf8"),
            uri: pathToFileURL(file).toString(),
            parser,
            symbols,
            engine,
        });
    });

    // A floor on the population, so a corpus that silently collapses to a handful cannot pass vacuously. The
    // counts are IN THE NAME, not a console.log: only the name survives under the default reporter and in a
    // failure line, so it is the only place a shrunken corpus reads differently from a clean one.
    it(`draws a corpus large enough to mean something (${files.length} files, ${selfContained.length} self-contained, ${needsInstall.length} install-gated)`, () => {
        expect(files.length).toBeGreaterThan(500);
        expect(selfContained.length).toBeGreaterThan(300);
    });

    // The synchronous WeiDU spawns (~0.15s each) genuinely run past the file's 60s testTimeout on their
    // own, before any contention; a synchronous loop cannot yield for vitest's timeout to interrupt it
    // early, so a shared default just makes the failure mode a flaky "timed out" instead of a clean bound.
    it(`agrees with the reference on every self-contained file (${selfContained.length} files)`, () => {
        const disagreements: string[] = [];
        // Refusals both sides agree on, grouped by the IDS table WeiDU's own message names: a bare count
        // cannot say whether a change in it is a real regression or just a different install's edition gaps.
        const mutualRefusals = new Map<string, number>();
        for (const file of selfContained) {
            const ours = compileBafText(opts(file)).errors.length === 0;
            const { accepted: theirs, output } = weiduVerdict(file);
            if (ours !== theirs) {
                disagreements.push(
                    `${file}: built-in ${ours ? "accepted" : "refused"}, reference ${theirs ? "accepted" : "refused"}`,
                );
            } else if (!ours) {
                const reason = refusalReason(output);
                mutualRefusals.set(reason, (mutualRefusals.get(reason) ?? 0) + 1);
            }
        }
        const bothRefused = [...mutualRefusals.values()].reduce((sum, count) => sum + count, 0);
        const tally = [...mutualRefusals].map(([reason, count]) => `${reason}=${count}`).join(", ");
        // Agreement on REFUSAL is not evidence the compiler works, so the tally is printed rather than folded
        // into the pass. It grows when the install lacks a game edition the corpus targets.
        console.log(
            `agreed on ${selfContained.length - disagreements.length}, of which ${bothRefused} were refused by both (${tally})`,
        );
        // Not a quality bar: a sanity floor that catches the gate collapsing into mutual silence (e.g. every
        // file wrongly landing in the install-gated partition), where neither side is actually being tested.
        expect(bothRefused).toBeLessThan(selfContained.length / 3);
        // The whole list, not the first: fixing these one compile-and-read cycle at a time is the cost this
        // avoids, and the shape of the set is what says whether it is one bug or many.
        expect(disagreements).toEqual([]);
    }, 120000);

    /**
     * The other half of the gate. A compiler that ACCEPTS what it cannot resolve is the worse of the two
     * failures - it would emit a script that assembles cleanly and behaves wrongly - so the refusal set is
     * asserted as tightly as the agreement set.
     */
    it("refuses every install-gated file, naming the construct", () => {
        const wrong: string[] = [];
        for (const file of needsInstall) {
            const errors = compileBafText(opts(file)).errors;
            if (errors.length === 0) wrong.push(`${file}: accepted a file it cannot resolve`);
            else if (!/%|@/.test(errors[0]!.message))
                wrong.push(`${file}: refused without naming the construct: ${errors[0]!.message}`);
        }
        expect(wrong).toEqual([]);
    });
});

interface WeiduVerdict {
    readonly accepted: boolean;
    readonly output: string;
}

/**
 * Whether WeiDU's own parser accepts `file`, run against the same install the built-in compiler reads.
 *
 * The exit code alone is not WeiDU's verdict: it reports an unresolved IDS argument as a `PARSE ERROR` line
 * on stdout while still exiting 0 and printing "successfully parsed", so that line overrides a clean exit.
 * A genuine parse failure (status 4) is always a refusal; any other thrown status is not a verdict at all.
 */
function weiduVerdict(file: string): WeiduVerdict {
    try {
        const output = execFileSync(WEIDU, ["--no-exit-pause", "--noautoupdate", "--parse-check", "baf", file], {
            cwd: GAME,
            timeout: WEIDU_TIMEOUT_MS,
            stdio: "pipe",
        }).toString();
        return { accepted: !PARSE_ERROR.test(output), output };
    } catch (error) {
        const status = (error as { status?: number | null }).status;
        if (status === WEIDU_PARSE_ERROR) {
            const output = (error as { stdout?: Buffer | string | null }).stdout?.toString() ?? "";
            return { accepted: false, output };
        }
        throw new Error(`weidu gave no verdict for ${file} (status ${String(status)})`, { cause: error });
    }
}

const PARSE_ERROR = /PARSE ERROR/;

/** The IDS table WeiDU's message names for an unresolved-argument refusal; "other" for every other shape. */
function refusalReason(output: string): string {
    return /not found in \[([A-Za-z0-9_]+\.IDS)\]/.exec(output)?.[1] ?? "other";
}
