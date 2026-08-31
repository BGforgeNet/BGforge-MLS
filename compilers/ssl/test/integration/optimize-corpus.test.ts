/**
 * The optimised twin of the compile differential: same corpus, same committed oracles, checked at both
 * `-O1` and `-O2`.
 *
 * This is the only gate that can hold the optimiser honest. Its passes REMOVE things, so nothing about
 * the unoptimised output constrains them, and a wrong removal produces a script that loads fine and then
 * misbehaves in-game - no exception, no diagnostic, nothing a unit test on hand-written IR would notice.
 * Byte-equality across 1500 real scripts is what turns "the removals look right" into a checked claim.
 * The oracles are committed digests of the bundled compiler's output (oracle-manifest.ts explains why
 * that is sound and how staleness fails loud; `pnpm ssl-oracles` regenerates them live).
 *
 * Reading a failure: the two sides agree on WHAT is dead, so a mismatch is nearly always a stale
 * reference to something removed - a procedure slot or global index that was not renumbered, or a string
 * literal left interned by code that no longer exists, which shifts every later string offset.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { Language, Parser } from "web-tree-sitter";
import { compileText } from "../../src/compile.ts";
import { preprocess } from "../../src/preprocess.ts";
import { REPO_ROOT } from "../../../../shared/cli/test/repo-root.ts";
import { BROKEN_WHEN_OPTIMISED, CORPUS_SIZE, listScripts } from "./corpus.ts";
import { currentPins, loadManifest, sha256, staleness } from "./oracle-manifest.ts";
import { builtArtifactsPresent } from "../../../../shared/cli/test/built-artifacts.ts";

const WASM_DIR = path.join(REPO_ROOT, "server/out");
const FALLOUT = path.join(REPO_ROOT, "external/fallout");

/** Same sanity floor as the unoptimised differential, and the same reasoning behind it. */
const ORACLE_FLOOR = 1425;

const scripts = listScripts();
const manifest = loadManifest();
const wasmPresent = builtArtifactsPresent([path.join(WASM_DIR, "tree-sitter-ssl.wasm")], "pnpm build:grammar");
// The manifest is COMMITTED, so its absence is a deletion to report, not a reason to skip - only a
// corpus that was never fetched or an unbuilt grammar makes this suite meaningless.
const ready = wasmPresent && scripts.length > 0;

describe.skipIf(!ready).each([1, 2] as const)("the real corpus optimises to matching bytecode at -O%d", (level) => {
    let parser: Parser;

    beforeAll(async () => {
        await Parser.init({ wasmBinary: fs.readFileSync(path.join(WASM_DIR, "web-tree-sitter.wasm")) });
        parser = new Parser();
        parser.setLanguage(await Language.load(path.join(WASM_DIR, "tree-sitter-ssl.wasm")));
    });

    it("was generated against the pins as they stand", () => {
        // First, so a red run after a compiler or corpus bump reads as "regenerate", never as an
        // optimiser defect (see the same assertion in compile-corpus.test.ts).
        const pins = currentPins();
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        expect(staleness(manifest as NonNullable<typeof manifest>, pins.compilerPin, pins.corpusPins)).toEqual([]);
    });

    it("matches the oracles", () => {
        expect(manifest, "committed oracle manifest is missing - run: pnpm ssl-oracles").not.toBeNull();
        const oracles = manifest as NonNullable<typeof manifest>;
        let matching = 0;
        let differing = 0;
        let unlisted = 0;
        const failures = new Map<string, number>();
        const excludedStems: string[] = [];
        const differences: string[] = [];

        for (const script of scripts) {
            const key = path.relative(FALLOUT, script);
            const digest = oracles.entries.get(key)?.[level];
            if (digest === undefined) {
                unlisted++;
                continue;
            }
            if (digest === "refused") {
                excludedStems.push(path.basename(script, path.extname(script)));
                continue;
            }

            let actual: Uint8Array;
            try {
                actual = compileText(parser, preprocess(script), { level });
            } catch (error) {
                const message = (error as Error).message.replace(/^\d+:\d+: /, "");
                const reason = message.startsWith("unknown ") ? message.replaceAll(/'[^']*'/g, "'X'") : message;
                failures.set(reason, (failures.get(reason) ?? 0) + 1);
                continue;
            }
            if (sha256(actual) === digest) matching++;
            else {
                differing++;
                // Named, because at this scale "37 differ" is not something anyone can act on.
                if (differences.length < 10) differences.push(`${key} (ours ${actual.length}b)`);
            }
        }

        const report = [...failures.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 12)
            .map(([reason, count]) => `  ${String(count).padStart(5)}  ${reason}`)
            .join("\n");
        const errors = [...failures.values()].reduce((a, b) => a + b, 0);
        const summary = [
            `corpus ${scripts.length}, oracles ${matching + differing}, matching ${matching}, ` +
                `differing ${differing}, errors ${errors}, unlisted ${unlisted}`,
            `oracle refusals ${excludedStems.length}: ${excludedStems.join(", ") || "none"}`,
            `first differences: ${differences.join(", ") || "none"}`,
            report,
        ].join("\n");

        expect(scripts.length, summary).toBe(CORPUS_SIZE);
        expect(unlisted, summary).toBe(0);
        expect(matching + differing, summary).toBeGreaterThan(ORACLE_FLOOR);
        expect(excludedStems.toSorted(), summary).toEqual(BROKEN_WHEN_OPTIMISED);
        expect(differing, summary).toBe(0);
        expect(errors, summary).toBe(0);
    });
});
