/**
 * Compiles the real Restoration Project corpus and byte-compares against the committed oracles.
 *
 * The hand-written cases in `test/int/` cover constructs one at a time; this is the sweep that says how
 * much of the actual language the compiler handles. The oracles are digests of what the bundled compiler
 * produced for the SAME preprocessed text (see oracle-manifest.ts for why they can be committed, how
 * staleness fails loud, and `pnpm ssl-oracles` to regenerate them from the live compiler).
 *
 * The gate is that NOTHING with an oracle comes back different, plus a sanity floor on how many oracles
 * exist at all. Every script the bundled compiler refused is excluded by name against a pinned list,
 * because an exclusion nobody can see is a comparison that quietly shrank.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_STEMS, CORPUS_SIZE, listScripts } from "./corpus.ts";
import { currentPins, loadManifest, sha256, staleness } from "./oracle-manifest.ts";
import { builtArtifactsPresent } from "../../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const FALLOUT = path.join(REPO_ROOT, "external/fallout");

/**
 * How many oracles the manifest must hold before its verdict means anything - a sanity floor on the
 * comparison's population, deliberately below the ~1544 recorded today. It catches a collapsed corpus or
 * a manifest generated against one; the gate itself is `differing === 0`.
 */
const ORACLE_FLOOR = 1425;

const scripts = listScripts();
const manifest = loadManifest();
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");
// The manifest is COMMITTED, so its absence is a deletion to report, not a reason to skip - only a
// corpus that was never fetched or an unbuilt grammar makes this suite meaningless.
const ready = wasmPresent && scripts.length > 0;

describe.skipIf(!ready)("real corpus compiles to matching bytecode", () => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("was generated against the pins as they stand", () => {
        // First, so a red run after a compiler or corpus bump reads as "regenerate", never as a codegen
        // defect. Without this, a compiler bump would leave the sweep green against a dead oracle.
        const pins = currentPins();
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        expect(staleness(manifest as NonNullable<typeof manifest>, pins.compilerPin, pins.corpusPins)).toEqual([]);
    });

    it("matches the oracles on the corpus", () => {
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        const oracles = manifest as NonNullable<typeof manifest>;
        let matching = 0;
        let differing = 0;
        let unlisted = 0;
        const failures = new Map<string, number>();
        // Scripts whose oracle is a refusal. Excluding them is right - there is nothing to compare - but
        // the exclusion has to be visible, or a shrunken comparison reads exactly like a clean one.
        const excludedStems: string[] = [];
        const differences: string[] = [];

        for (const script of scripts) {
            const key = path.relative(FALLOUT, script);
            const digest = oracles.entries.get(key)?.[0];
            if (digest === undefined) {
                // A script the manifest has never seen means the corpus and manifest disagree about the
                // population itself - regeneration territory, counted rather than skipped.
                unlisted++;
                continue;
            }
            if (digest === "refused") {
                excludedStems.push(path.basename(script, path.extname(script)));
                continue;
            }

            let actual: Uint8Array;
            try {
                actual = compileText(parser, preprocess(script));
            } catch (error) {
                // Group by message shape so the report names the gaps, not 1500 individual scripts.
                const message = (error as Error).message.replace(/^\d+:\d+: /, "");
                const reason = message.startsWith("unknown ") ? message.replaceAll(/'[^']*'/g, "'X'") : message;
                failures.set(reason, (failures.get(reason) ?? 0) + 1);
                continue;
            }
            if (sha256(actual) === digest) matching++;
            else {
                differing++;
                if (differences.length < 10) differences.push(key);
            }
        }

        const report = [...failures.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([reason, count]) => `  ${String(count).padStart(5)}  ${reason}`)
            .join("\n");
        const errors = [...failures.values()].reduce((a, b) => a + b, 0);
        // The corpus total leads: without it, the oracle count is a number with no population behind it
        // and a shrunken comparison cannot be told from a complete one.
        const summary = [
            `corpus ${scripts.length}, oracles ${matching + differing}, matching ${matching}, ` +
                `differing ${differing}, errors ${errors}, unlisted ${unlisted}`,
            `oracle refusals ${excludedStems.length}: ${excludedStems.join(", ") || "none"}`,
            `first differences: ${differences.join(", ") || "none"}`,
            report,
        ].join("\n");

        // Guard the denominator first: with no oracles every other number is trivially zero, and the
        // assertions below would pass while nothing was compared at all.
        expect(scripts.length, summary).toBe(CORPUS_SIZE);
        expect(unlisted, summary).toBe(0);
        expect(matching + differing, summary).toBeGreaterThan(ORACLE_FLOOR);
        // Pinned by name: a refusal outside this set means a script stopped building for a reason nobody
        // has looked at, which silently removes it from the comparison.
        expect(excludedStems.toSorted(), summary).toEqual(BROKEN_STEMS);
        expect(differing, summary).toBe(0);
        expect(errors, summary).toBe(0);
    });
});
