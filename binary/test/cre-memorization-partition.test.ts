/**
 * Characterization: the spellMemInfo -> memorizedSpells partition over every
 * real CRE fixture. This is the load-bearing invariant the CRE owner+slice
 * structure-ops rely on (binary/src/ie-common/slice-structure-ops.ts):
 *
 *   - the RELAXED partition (coverage + overlap + bounds, NO ordering) holds
 *     for every fixture - so the surgical ops never hit an orphan/overlap;
 *   - the STRICT (in-order contiguous) partition is violated by at least one
 *     fixture - proving the order-agnostic relaxation is necessary, not cosmetic.
 *
 * If a future fixture import breaks the relaxed invariant, the ops' save-time
 * validateEffectPartition would start throwing on real files; this test makes
 * that regression visible here first.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { creParser } from "../src/cre";
import { getCreCanonicalDocument, rebuildCreCanonicalDocument } from "../src/cre/canonical-reader";
import { createEffectPartition, type IeEffectRangeFields } from "../src/ie-common/effect-partition";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EXTERNAL_ROOT = path.join(REPO_ROOT, "external/infinity-engine");

function findCreFixtures(root: string): string[] {
    const out: string[] = [];
    function walk(dir: string): void {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.isFile() && e.name.toLowerCase().endsWith(".cre")) out.push(full);
        }
    }
    if (fs.existsSync(root)) walk(root);
    return out.sort();
}

const MEMO_FIELDS: IeEffectRangeFields = {
    abilityStart: "firstMemorizedSpellIndex",
    abilityCount: "memorizedSpellCount",
};

// The view createEffectPartition operates on: spellMemInfo as "abilities",
// memorizedSpells as "effects", an empty header (no equipping range).
function memoView(spellMemInfo: readonly unknown[], total: number) {
    return {
        header: {},
        abilities: [...spellMemInfo] as Record<string, unknown>[],
        effects: Array.from({ length: total }, (_, i) => i),
    };
}

describe("CRE memorization partition (characterization over real fixtures)", () => {
    const fixtures = findCreFixtures(EXTERNAL_ROOT);
    if (fixtures.length === 0) {
        test.skip("no CRE fixtures present", () => {});
        return;
    }

    const relaxed = createEffectPartition(MEMO_FIELDS, {
        requireContiguousOrder: false,
        ownerNoun: "memorization entry",
    });
    const strict = createEffectPartition(MEMO_FIELDS, {
        requireContiguousOrder: true,
        ownerNoun: "memorization entry",
    });

    test("the RELAXED partition is consistent for every fixture", () => {
        const offenders: string[] = [];
        for (const f of fixtures) {
            const r = creParser.parse(new Uint8Array(fs.readFileSync(f)));
            if (r.errors) continue;
            const doc = getCreCanonicalDocument(r) ?? rebuildCreCanonicalDocument(r);
            if (!doc) continue;
            const issues = relaxed.validateEffectPartition(memoView(doc.spellMemInfo, doc.memorizedSpells.length));
            if (issues.length > 0) offenders.push(`${path.basename(f)}: ${issues.join("; ")}`);
        }
        expect(offenders).toEqual([]);
    });

    test("at least one fixture violates the STRICT ordering (relaxation is load-bearing)", () => {
        let outOfOrder = 0;
        for (const f of fixtures) {
            const r = creParser.parse(new Uint8Array(fs.readFileSync(f)));
            if (r.errors) continue;
            const doc = getCreCanonicalDocument(r) ?? rebuildCreCanonicalDocument(r);
            if (!doc) continue;
            const issues = strict.validateEffectPartition(memoView(doc.spellMemInfo, doc.memorizedSpells.length));
            if (issues.length > 0) outOfOrder++;
        }
        expect(outOfOrder).toBeGreaterThan(0);
    });
});
