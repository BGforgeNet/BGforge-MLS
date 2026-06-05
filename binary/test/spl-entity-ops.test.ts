import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { splParser } from "../src/spl";
import { getSplCanonicalDocument, rebuildSplCanonicalDocument } from "../src/spl/canonical-reader";
import { serializeSplCanonicalDocument } from "../src/spl/canonical-writer";
import {
    buildSplAddAbilityBytes,
    buildSplDuplicateAbilityBytes,
    buildSplDuplicateEffectBytes,
    buildSplInsertAbilityBytes,
    buildSplInsertEffectBytes,
    buildSplRemoveAbilityBytes,
    buildSplRemoveEffectBytes,
    buildSplReorderAbilityBytes,
    buildSplReorderEffectBytes,
    defaultSplAbility,
    splAbilitiesCollection,
    splEffectsCollection,
} from "../src/spl/entity-ops";
import { defaultIeEffect } from "../src/ie-common/structure-ops";
import { createEffectPartition, type IeEffectRangeFields } from "../src/ie-common/effect-partition";
import type { ParseResult } from "../src/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SPL_FIELDS: IeEffectRangeFields = {
    headerStart: "castingFeatureBlocksOffset",
    headerCount: "castingFeatureBlocksCount",
    abilityStart: "featureBlocksOffset",
    abilityCount: "featureBlocksCount",
};
const { validateEffectPartition } = createEffectPartition(SPL_FIELDS);

const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/Ascension/ascension/powers/resource/berserk.spl");
const hasFixture = fs.existsSync(FIXTURE);

/**
 * Build a synthetic 2-ability SPL parse result where ability0 owns effect[0]
 * and ability1 owns effects[1,2], so the relink is actually exercised by
 * different, non-zero slices. Each effect carries a distinct opcode so a test
 * can PROVE which physical effect a slice op moved (not just the counts).
 *
 * The casting range is empty (count 0) so the abilities own the entire flat
 * effects array contiguously, matching the proven casting-first invariant.
 */
function makeTwoAbilityBase(): ParseResult {
    const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getSplCanonicalDocument(parsed) ?? rebuildSplCanonicalDocument(parsed);
    const effect = (opcode: number) => ({ ...defaultIeEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
        abilities: [
            { ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 },
            { ...defaultSplAbility(), featureBlocksOffset: 1, featureBlocksCount: 2 },
        ],
        effects: [effect(10), effect(20), effect(21)],
    };
    const reparsed = splParser.parse(serializeSplCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

/**
 * Variant of the 2-ability base that ALSO carries one casting effect, so the
 * effect-op tests cover the casting-owner case. Layout:
 *   casting range [0,1) owns effect[0] (opcode 99);
 *   ability0 [1,1) owns effect[1] (opcode 10);
 *   ability1 [2,2) owns effects[2,3] (opcodes 20, 21).
 * effects = [99, 10, 20, 21]; each opcode is distinct so a test can PROVE which
 * physical effect moved and which owner it stayed under.
 */
function makeCastingPlusTwoAbilityBase(): ParseResult {
    const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getSplCanonicalDocument(parsed) ?? rebuildSplCanonicalDocument(parsed);
    const effect = (opcode: number) => ({ ...defaultIeEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 },
        abilities: [
            { ...defaultSplAbility(), featureBlocksOffset: 1, featureBlocksCount: 1 },
            { ...defaultSplAbility(), featureBlocksOffset: 2, featureBlocksCount: 2 },
        ],
        effects: [effect(99), effect(10), effect(20), effect(21)],
    };
    const reparsed = splParser.parse(serializeSplCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

function reparseSpl(bytes: Uint8Array) {
    const result = splParser.parse(bytes);
    if (result.errors) throw new Error(result.errors.join(", "));
    const doc = getSplCanonicalDocument(result) ?? rebuildSplCanonicalDocument(result);
    if (!doc) throw new Error("no canonical doc after reparse");
    return doc;
}

const opcodesOf = (effects: Array<{ opcode: number }>) => effects.map((e) => e.opcode);

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

describe("SPL default elements + collections", () => {
    it("collection descriptors expose the right capabilities", () => {
        expect(splAbilitiesCollection.addable).toBe(true);
        expect(splAbilitiesCollection.removable).toBe(true);
        expect(splEffectsCollection.addable).toBe(false); // owner-ambiguous; gated off
        expect(splEffectsCollection.removable).toBe(true);
    });

    it("defaultSplAbility has featureBlocksCount 0 and featureBlocksOffset 0", () => {
        const a = defaultSplAbility();
        expect(a.featureBlocksCount).toBe(0);
        expect(a.featureBlocksOffset).toBe(0);
    });

    it.skipIf(!hasFixture)("a default ability appended to a real SPL round-trips with featureBlocksCount 0", () => {
        const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getSplCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const origLen = doc.abilities.length;
        const next = { ...doc, abilities: [...doc.abilities, defaultSplAbility()] };
        const reparsed = splParser.parse(serializeSplCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getSplCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.abilities.length).toBe(origLen + 1);
        const newAbility = reparsedDoc.abilities.at(-1);
        expect(newAbility).toBeDefined();
        expect(newAbility?.featureBlocksCount).toBe(0);
        expect(newAbility?.featureBlocksOffset).toBe(0);
    });

    it.skipIf(!hasFixture)("default effect round-trips when appended with a default ability that owns it", () => {
        const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getSplCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        // Append a default effect to doc.effects and a new ability whose
        // featureBlocksOffset points at it and featureBlocksCount is 1.
        // This validates that the default effect serializes cleanly; the
        // owner-relink itself is exercised by the structure-op tests below.
        const effectIndex = doc.effects.length;
        const newAbility = { ...defaultSplAbility(), featureBlocksOffset: effectIndex, featureBlocksCount: 1 };
        const next = {
            ...doc,
            abilities: [...doc.abilities, newAbility],
            effects: [...doc.effects, defaultIeEffect()],
        };
        const reparsed = splParser.parse(serializeSplCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getSplCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.effects.length).toBe(doc.effects.length + 1);
        const reparsedAbility = reparsedDoc.abilities.at(-1);
        expect(reparsedAbility).toBeDefined();
        expect(reparsedAbility?.featureBlocksCount).toBe(1);
    });

    it.skipIf(!hasFixture)("collection read/write round-trip preserves the array via splAbilitiesCollection", () => {
        const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getSplCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const abilities = splAbilitiesCollection.read(doc);
        const rebuilt = splAbilitiesCollection.write(doc, abilities);
        expect(rebuilt.abilities.length).toBe(doc.abilities.length);
    });

    it.skipIf(!hasFixture)("collection read/write round-trip preserves the array via splEffectsCollection", () => {
        const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getSplCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const effects = splEffectsCollection.read(doc);
        const rebuilt = splEffectsCollection.write(doc, effects);
        expect(rebuilt.effects.length).toBe(doc.effects.length);
    });
});

describe("SPL ability structure-ops with effect-slice relinking", () => {
    it.skipIf(!hasFixture)("the synthetic base has two abilities owning distinct, non-zero effect slices", () => {
        const doc = reparseSpl(splParser.serialize!(makeTwoAbilityBase()));
        expect(doc.abilities.length).toBe(2);
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21]);
        expect(doc.header.castingFeatureBlocksCount).toBe(0);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("add appends an empty-slice ability and leaves effects untouched", () => {
        const bytes = buildSplAddAbilityBytes(makeTwoAbilityBase(), ["Abilities"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.abilities[2]).toMatchObject({ featureBlocksCount: 0 });
        // New empty slice sits at the end (running offset == effects.length).
        expect(doc.abilities[2]!.featureBlocksOffset).toBe(3);
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove drops the ability and its owned effect slice; survivor re-anchors", () => {
        // Remove ability0 (1-based label "Ability 1"); its single effect (opcode 10) goes,
        // leaving ability1's two effects (20, 21) starting at the casting-end index 0.
        const bytes = buildSplRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(1);
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 2 });
        expect(opcodesOf(doc.effects)).toEqual([20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder down swaps abilities AND their adjacent effect slices", () => {
        // Move ability0 ("Ability 1") down: ability1 (slice [20,21]) now precedes
        // ability0 (slice [10]); the physical effect order proves the slice moved.
        const bytes = buildSplReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "down");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(2);
        // Slot 0 now owns the formerly-ability1 2-effect slice; slot 1 owns the 1-effect slice.
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(opcodesOf(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder up on the second ability mirrors reorder down on the first", () => {
        const bytes = buildSplReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "up");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(opcodesOf(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder at the boundary is a no-op (returns undefined)", () => {
        expect(buildSplReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "up")).toBeUndefined();
        expect(buildSplReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("duplicate clones the ability and its effect slice right after the source", () => {
        // Duplicate ability1 ("Ability 2", owns [20,21]); the clone + its cloned slice
        // are inserted right after the original slice (at s_k + c_k == 3).
        const bytes = buildSplDuplicateAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.effects.length).toBe(5);
        // Source slice (20,21) stays; clone (20,21) follows; ability0's single effect (10) leads.
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21, 20, 21]);
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(doc.abilities[2]).toMatchObject({ featureBlocksOffset: 3, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before adds an empty-slice ability at the slot; effects untouched", () => {
        const bytes = buildSplInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "before");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(3);
        // New empty ability at slot 0; the two real abilities keep their slices.
        expect(doc.abilities[0]).toMatchObject({ featureBlocksCount: 0 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 1 });
        expect(doc.abilities[2]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after adds an empty-slice ability after the slot; effects untouched", () => {
        const bytes = buildSplInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "after");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 1 });
        // New empty ability at slot 1 (after ability0).
        expect(doc.abilities[1]).toMatchObject({ featureBlocksCount: 0 });
        expect(doc.abilities[2]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("rejects a non-ability path (returns undefined)", () => {
        expect(buildSplAddAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildSplRemoveAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildSplRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 99"])).toBeUndefined();
    });
});

describe("SPL effect structure-ops with owner-aware relinking", () => {
    it.skipIf(!hasFixture)("the casting base lays out casting + two abilities over [99,10,20,21]", () => {
        const doc = reparseSpl(splParser.serialize!(makeCastingPlusTwoAbilityBase()));
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 2 });
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before an ability-owned effect grows that ability and shifts later ranges", () => {
        // "Effect 3" (1-based) is effects[2] (opcode 20), owned by ability1.
        const bytes = buildSplInsertEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 3"], "before");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        // A default (opcode 0) effect lands before opcode 20.
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 0, 20, 21]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 }); // casting unchanged
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 3 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after an ability-owned effect grows that ability and shifts later ranges", () => {
        // "Effect 2" is effects[1] (opcode 10), the sole effect of ability0.
        const bytes = buildSplInsertEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 2"], "after");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 0, 20, 21]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 3, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after the casting effect grows the header and shifts all ability indices", () => {
        // "Effect 1" is effects[0] (opcode 99), the casting effect.
        const bytes = buildSplInsertEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 1"], "after");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([99, 0, 10, 20, 21]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 2 });
        // Both abilities shift +1.
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 3, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before the casting effect grows the header and shifts all ability indices", () => {
        // "Effect 1" is effects[0] (opcode 99), the casting effect. "before"
        // inserts at index 0; the casting range absorbs the new effect and every
        // ability range shifts +1.
        const bytes = buildSplInsertEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 1"], "before");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([0, 99, 10, 20, 21]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 2 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 3, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove an ability-owned effect shrinks that ability and shifts later ranges", () => {
        // "Effect 3" is effects[2] (opcode 20), the first of ability1's two effects.
        const bytes = buildSplRemoveEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 3"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 21]); // opcode 20 gone
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove the casting effect shrinks the header and shifts ability indices down", () => {
        // "Effect 1" is effects[0] (opcode 99), the casting effect.
        const bytes = buildSplRemoveEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 1"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([10, 20, 21]); // opcode 99 gone
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 0, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)(
        "duplicate an ability-owned effect grows that ability and clones the opcode adjacently",
        () => {
            // "Effect 3" is effects[2] (opcode 20), owned by ability1.
            const bytes = buildSplDuplicateEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 3"]);
            expect(bytes).toBeDefined();
            const doc = reparseSpl(bytes!);
            // The clone (opcode 20) lands right after the source.
            expect(opcodesOf(doc.effects)).toEqual([99, 10, 20, 20, 21]);
            expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 });
            expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 1 });
            expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 3 });
            expect(validateEffectPartition(doc)).toEqual([]);
        },
    );

    it.skipIf(!hasFixture)("duplicate a casting-owned effect grows the header and clones the opcode adjacently", () => {
        // "Effect 1" is effects[0] (opcode 99), the casting effect.
        const bytes = buildSplDuplicateEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 1"]);
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        // The clone (opcode 99) lands right after the source; header count grows.
        expect(opcodesOf(doc.effects)).toEqual([99, 99, 10, 20, 21]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 2 });
        // Both abilities shift +1.
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 3, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("the duplicated effect is a distinct object (deep clone, no aliasing)", () => {
        const base = makeCastingPlusTwoAbilityBase();
        const bytes = buildSplDuplicateEffectBytes(base, ["Effects", "Effect 3"]);
        expect(bytes).toBeDefined();
        const result = reparseSpl(bytes!);
        // Two distinct effects carry opcode 20 (source + clone); reparse yields
        // separate objects, proving the clone is not the same reference.
        const twenties = result.effects.filter((e) => e.opcode === 20);
        expect(twenties.length).toBe(2);
        expect(twenties[0]).not.toBe(twenties[1]);
    });

    it.skipIf(!hasFixture)("reorder within the same owner swaps opcodes without changing counts or indices", () => {
        // ability1 owns effects[2,3] (opcodes 20, 21). Reorder "Effect 3" (opcode 20)
        // down swaps it with its same-owner neighbor opcode 21.
        const bytes = buildSplReorderEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 3"], "down");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(doc.header).toMatchObject({ castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlocksOffset: 1, featureBlocksCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlocksOffset: 2, featureBlocksCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder up mirrors reorder down within the same owner", () => {
        // "Effect 4" (opcode 21) up swaps with same-owner neighbor opcode 20.
        const bytes = buildSplReorderEffectBytes(makeCastingPlusTwoAbilityBase(), ["Effects", "Effect 4"], "up");
        expect(bytes).toBeDefined();
        const doc = reparseSpl(bytes!);
        expect(opcodesOf(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder across an owner boundary is rejected (returns undefined)", () => {
        // ability0 owns the single effect[1] (opcode 10). Reordering it "down"
        // would cross into ability1; "up" would cross into casting. Both rejected.
        const base = makeCastingPlusTwoAbilityBase;
        expect(buildSplReorderEffectBytes(base(), ["Effects", "Effect 2"], "down")).toBeUndefined();
        expect(buildSplReorderEffectBytes(base(), ["Effects", "Effect 2"], "up")).toBeUndefined();
        // The casting effect[0] has no lower neighbor and "down" crosses into ability0.
        expect(buildSplReorderEffectBytes(base(), ["Effects", "Effect 1"], "up")).toBeUndefined();
        expect(buildSplReorderEffectBytes(base(), ["Effects", "Effect 1"], "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("rejects a non-effects path or out-of-range effect (returns undefined)", () => {
        const base = makeCastingPlusTwoAbilityBase;
        expect(buildSplInsertEffectBytes(base(), ["Abilities", "Ability 1"], "before")).toBeUndefined();
        expect(buildSplRemoveEffectBytes(base(), ["Header", "Signature"])).toBeUndefined();
        expect(buildSplRemoveEffectBytes(base(), ["Effects", "Effect 99"])).toBeUndefined();
        expect(buildSplDuplicateEffectBytes(base(), ["Effects", "Effect 0"])).toBeUndefined();
        expect(buildSplReorderEffectBytes(base(), ["Effects", "Effect 99"], "up")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("removes the first effect of a casting-free spell without throwing", () => {
        // Build a casting-free synthetic base (castingFeatureBlocksCount: 0) with a single
        // ability-owned effect, then remove it. This is the SPL analog of the ITM db749e07
        // regression: the empty-casting-range start must not be clamped below 0 after the
        // shift, so serialization succeeds when the ability-owned effect slice shifts down.
        const parsed = splParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getSplCanonicalDocument(parsed) ?? rebuildSplCanonicalDocument(parsed);
        const base = {
            ...doc,
            header: { ...doc.header, castingFeatureBlocksOffset: 0, castingFeatureBlocksCount: 0 },
            abilities: [{ ...defaultSplAbility(), featureBlocksOffset: 0, featureBlocksCount: 1 }],
            effects: [{ ...defaultIeEffect(), opcode: 7 }],
        };
        const pr = splParser.parse(serializeSplCanonicalDocument(base));
        if (pr.errors) throw new Error(`casting-free base reparse errors: ${pr.errors.join(", ")}`);
        const before = getSplCanonicalDocument(pr) ?? rebuildSplCanonicalDocument(pr);
        expect(before.header.castingFeatureBlocksCount).toBe(0); // no casting effects
        expect(before.effects.length).toBe(1); // single ability-owned effect

        const bytes = buildSplRemoveEffectBytes(pr, ["Effects", "Effect 1"]);
        expect(bytes).toBeDefined();
        const result = reparseSpl(bytes!);
        expect(result.effects.length).toBe(0);
        expect(validateEffectPartition(result)).toEqual([]);
    });
});

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
