import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splParser } from "../src/spl";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "../src/spl/canonical-reader";
import { createEffectPartition, type IeEffectRangeFields } from "../src/ie-common/effect-partition";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SPL_FIELDS: IeEffectRangeFields = {
    headerStart: "castingFeatureBlocksOffset",
    headerCount: "castingFeatureBlocksCount",
    abilityStart: "featureBlocksOffset",
    abilityCount: "featureBlocksCount",
};
const { validateEffectPartition } = createEffectPartition(SPL_FIELDS);

// Walk external/ for .spl fixtures (mirrors how the ITM characterization sampled .itm).
function findSplFixtures(): string[] {
    const root = path.join(REPO_ROOT, "external");
    if (!fs.existsSync(root)) return [];
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.isFile() && entry.name.toLowerCase().endsWith(".spl")) out.push(full);
        }
    };
    walk(root);
    return out;
}

const fixtures = findSplFixtures();

describe("SPL effect partition characterization (real fixtures)", () => {
    it.skipIf(fixtures.length === 0)(
        "every parseable .spl fixture has a clean casting-first contiguous partition",
        () => {
            let checked = 0;
            const violations: string[] = [];
            for (const file of fixtures) {
                const parsed = splParser.parse(new Uint8Array(fs.readFileSync(file)));
                if (parsed.errors) continue; // skip non-v1 / malformed fixtures, like the ITM characterization did
                // rebuildSplCanonicalDocument returns a Doc or THROWS (never null), so a parse-success-but-rebuild-failure
                // surfaces as a loud test failure - the desired characterization signal, not a skipped case.
                const doc = getSplCanonicalDocument(parsed) ?? rebuildSplCanonicalDocument(parsed);
                checked++;
                const issues = validateEffectPartition(doc);
                if (issues.length > 0) violations.push(`${path.relative(REPO_ROOT, file)}: ${issues.join("; ")}`);
            }
            // Surface what was actually checked so a zero-fixture or all-skipped run is visible, not silently "passing".
            expect(checked).toBeGreaterThan(0);
            expect(violations).toEqual([]);
        },
    );
});
