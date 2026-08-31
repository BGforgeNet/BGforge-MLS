/**
 * A canary over the committed oracles: the pins as they stand, plus a fixed stride through the corpus.
 *
 * The sweeps beside this file answer "does the WHOLE corpus still compile to the recorded bytes" and take
 * minutes, so they belong to the close-out gate. This one answers the categorical question the dev loop
 * needs - is the manifest still valid against its pins, does the pipeline still produce recorded bytes at
 * all - over a slice small enough to run beside the unit suites. `pnpm test` runs this; `pnpm test:all`
 * runs it and the sweeps.
 *
 * Two properties are deliberate. It reports its own denominator, because a sampled green that reads as a
 * swept green is worse than no probe at all. And it takes its OWN slice rather than narrowing the sweeps
 * with `SSL_CORPUS_LIMIT`: that switch is for reading a report while debugging and cannot pass a suite by
 * design - the sweeps assert the full population first, which is the guard that stops a collapsed corpus
 * passing vacuously. A canary must not be built by weakening it.
 *
 * The slice is a stride rather than the first N, taken per mod, so it spans the corpus instead of
 * whichever directory sorts first - see `OTHER_SAMPLE` for why the two small mods are drawn separately.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { listScripts, RP_SCRIPTS } from "./corpus.ts";
import { currentPins, loadManifest, sha256, staleness } from "./oracle-manifest.ts";
import { builtArtifactsPresent } from "../../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const FALLOUT = path.join(REPO_ROOT, "external/fallout");

/** How many scripts the canary compiles. Sized to keep it under the dev loop's existing critical path. */
const SAMPLE = 24;

/**
 * The comparison floor, a margin below the 22 the sample compares today - the other two are scripts the
 * reference itself refused (`zccorpse`, `gl_p_party_orders`), which is the exclusion path working. It
 * catches the slice degenerating - a corpus mid-reset, a manifest that lost most of its entries - which
 * would otherwise report zero differences over almost nothing.
 */
const COMPARED_FLOOR = SAMPLE - 4;

/**
 * How many of the sample come from the mods other than the Restoration Project. They are 28 scripts
 * against RP's fifteen hundred, so a stride over the concatenated corpus reaches at most one of them by
 * arithmetic - and `corpus.ts` records three defects found by compiling exactly those, none of which any
 * RP script exposes. Sampling them separately is what keeps a house style out of the canary.
 */
const OTHER_SAMPLE = 4;

/** `n` scripts spread evenly across `all`, deterministic for a given corpus, inclusive of both ends. */
function stride(all: readonly string[], n: number): string[] {
    if (all.length <= n) return [...all];
    const step = (all.length - 1) / (n - 1);
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
        const script = all[Math.round(i * step)];
        if (script !== undefined) out.push(script);
    }
    return out;
}

/** The sample: a stride through RP, plus a stride through everything else. */
function sample(all: readonly string[]): string[] {
    const rp = all.filter((script) => script.startsWith(RP_SCRIPTS));
    const other = all.filter((script) => !script.startsWith(RP_SCRIPTS));
    return [...stride(rp, SAMPLE - OTHER_SAMPLE), ...stride(other, OTHER_SAMPLE)];
}

const scripts = listScripts();
const manifest = loadManifest();
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");
// Same readiness rule as the sweeps: an unfetched corpus or an unbuilt grammar makes this meaningless,
// while the manifest is committed, so its absence is a deletion to report rather than a reason to skip.
const ready = wasmPresent && scripts.length > 0;

describe.skipIf(!ready)("corpus canary", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("was generated against the pins as they stand", () => {
        // The cheap half of the canary and the one that catches the failure a slice cannot: a compiler or
        // corpus bump leaves every digest valid-looking and every comparison meaningless.
        const pins = currentPins();
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        expect(staleness(manifest as NonNullable<typeof manifest>, pins.compilerPin, pins.corpusPins)).toEqual([]);
    });

    it("matches the oracles on a sample of the corpus", () => {
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        const oracles = manifest as NonNullable<typeof manifest>;
        const sampled = sample(scripts);
        let compared = 0;
        let differing = 0;
        let unlisted = 0;
        const refused: string[] = [];
        const differences: string[] = [];
        const errors: string[] = [];

        for (const script of sampled) {
            const key = path.relative(FALLOUT, script);
            const digest = oracles.entries.get(key)?.[0];
            if (digest === undefined) {
                unlisted++;
                continue;
            }
            if (digest === "refused") {
                refused.push(path.basename(script, path.extname(script)));
                continue;
            }
            let actual: Uint8Array;
            try {
                actual = compileText(parser, preprocess(script));
            } catch (error) {
                errors.push(`${key}: ${(error as Error).message}`);
                continue;
            }
            compared++;
            if (sha256(actual) !== digest) {
                differing++;
                differences.push(key);
            }
        }

        // The sample size leads and names the population it came from: this suite's green says nothing
        // about the other ~1500 scripts, and the sweeps in this directory are what does.
        const summary = [
            `SAMPLE of ${sampled.length} scripts drawn from ${scripts.length} - the full sweeps are ` +
                `compile-corpus/decompile-corpus/optimize-corpus, run by pnpm test:all`,
            `compared ${compared}, differing ${differing}, errors ${errors.length}, unlisted ${unlisted}`,
            `oracle refusals ${refused.length}: ${refused.join(", ") || "none"}`,
            `first differences: ${differences.slice(0, 5).join(", ") || "none"}`,
            errors.slice(0, 5).join("\n"),
        ].join("\n");

        expect(unlisted, summary).toBe(0);
        expect(compared, summary).toBeGreaterThanOrEqual(COMPARED_FLOOR);
        expect(errors, summary).toEqual([]);
        expect(differing, summary).toBe(0);
    });
});
