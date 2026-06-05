import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../src/itm/canonical-writer";
import {
    buildItmAddAbilityBytes,
    buildItmDuplicateAbilityBytes,
    buildItmDuplicateEffectBytes,
    buildItmInsertAbilityBytes,
    buildItmInsertEffectBytes,
    buildItmRemoveAbilityBytes,
    buildItmRemoveEffectBytes,
    buildItmReorderAbilityBytes,
    buildItmReorderEffectBytes,
    defaultItmAbility,
    defaultItmEffect,
    itmAbilitiesCollection,
    itmEffectsCollection,
} from "../src/itm/entity-ops";
import { validateEffectPartition } from "../src/itm/effect-partition";
import type { ParseResult } from "../src/types";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const hasFixture = fs.existsSync(FIXTURE);

/**
 * Build a synthetic 2-ability ITM parse result where ability0 owns effect[0]
 * and ability1 owns effects[1,2], so the relink is actually exercised by
 * different, non-zero slices. Each effect carries a distinct opcode so a test
 * can PROVE which physical effect a slice op moved (not just the counts).
 *
 * The equipping range is empty (count 0) so the abilities own the entire flat
 * effects array contiguously, matching the proven equipping-first invariant.
 */
function makeTwoAbilityBase(): ParseResult {
    const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getItmCanonicalDocument(parsed) ?? rebuildItmCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");

    const effect = (opcode: number) => ({ ...defaultItmEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
        abilities: [
            { ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 1 },
            { ...defaultItmAbility(), featureBlockIndex: 1, featureBlockCount: 2 },
        ],
        effects: [effect(10), effect(20), effect(21)],
    };

    const reparsed = itmParser.parse(serializeItmCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

/**
 * Variant of the 2-ability base that ALSO carries one equipping effect, so the
 * effect-op tests cover the equipping-owner case. Layout:
 *   equipping range [0,1) owns effect[0] (opcode 99);
 *   ability0 [1,1) owns effect[1] (opcode 10);
 *   ability1 [2,2) owns effects[2,3] (opcodes 20, 21).
 * effects = [99, 10, 20, 21]; each opcode is distinct so a test can PROVE which
 * physical effect moved and which owner it stayed under.
 */
function makeEquippingPlusTwoAbilityBase(): ParseResult {
    const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getItmCanonicalDocument(parsed) ?? rebuildItmCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");

    const effect = (opcode: number) => ({ ...defaultItmEffect(), opcode });
    const base = {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: 0, featureBlocksCount: 1 },
        abilities: [
            { ...defaultItmAbility(), featureBlockIndex: 1, featureBlockCount: 1 },
            { ...defaultItmAbility(), featureBlockIndex: 2, featureBlockCount: 2 },
        ],
        effects: [effect(99), effect(10), effect(20), effect(21)],
    };

    const reparsed = itmParser.parse(serializeItmCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

function reparse(bytes: Uint8Array) {
    const result = itmParser.parse(bytes);
    if (result.errors) throw new Error(result.errors.join(", "));
    const doc = getItmCanonicalDocument(result) ?? rebuildItmCanonicalDocument(result);
    if (!doc) throw new Error("no canonical doc after reparse");
    return doc;
}

const opcodes = (effects: Array<{ opcode: number }>) => effects.map((e) => e.opcode);

describe("ITM default elements + collections", () => {
    it("collection descriptors expose the right capabilities", () => {
        expect(itmAbilitiesCollection.addable).toBe(true);
        expect(itmAbilitiesCollection.removable).toBe(true);
        expect(itmEffectsCollection.addable).toBe(false); // owner-ambiguous; gated off
        expect(itmEffectsCollection.removable).toBe(true);
    });

    it("defaultItmAbility has featureBlockCount 0 and featureBlockIndex 0", () => {
        const a = defaultItmAbility();
        expect(a.featureBlockCount).toBe(0);
        expect(a.featureBlockIndex).toBe(0);
    });

    it.skipIf(!hasFixture)("a default ability appended to a real ITM round-trips with featureBlockCount 0", () => {
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const origLen = doc.abilities.length;
        const next = { ...doc, abilities: [...doc.abilities, defaultItmAbility()] };
        const reparsed = itmParser.parse(serializeItmCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getItmCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.abilities.length).toBe(origLen + 1);
        const newAbility = reparsedDoc.abilities.at(-1);
        expect(newAbility).toBeDefined();
        expect(newAbility?.featureBlockCount).toBe(0);
        expect(newAbility?.featureBlockIndex).toBe(0);
    });

    it.skipIf(!hasFixture)("default effect round-trips when appended with a default ability that owns it", () => {
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        // Append a default effect to doc.effects and a new ability whose
        // featureBlockIndex points at it and featureBlockCount is 1.
        // This validates that the default effect serializes cleanly; the
        // owner-relink itself is exercised by the structure-op tests below.
        const effectIndex = doc.effects.length;
        const newAbility = { ...defaultItmAbility(), featureBlockIndex: effectIndex, featureBlockCount: 1 };
        const next = {
            ...doc,
            abilities: [...doc.abilities, newAbility],
            effects: [...doc.effects, defaultItmEffect()],
        };
        const reparsed = itmParser.parse(serializeItmCanonicalDocument(next));
        if (reparsed.errors) throw new Error(reparsed.errors.join(", "));
        const reparsedDoc = getItmCanonicalDocument(reparsed);
        if (!reparsedDoc) throw new Error("no canonical doc after reparse");
        expect(reparsedDoc.effects.length).toBe(doc.effects.length + 1);
        const reparsedAbility = reparsedDoc.abilities.at(-1);
        expect(reparsedAbility).toBeDefined();
        expect(reparsedAbility?.featureBlockCount).toBe(1);
    });

    it.skipIf(!hasFixture)("collection read/write round-trip preserves the array via itmAbilitiesCollection", () => {
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const abilities = itmAbilitiesCollection.read(doc);
        const rebuilt = itmAbilitiesCollection.write(doc, abilities);
        expect(rebuilt.abilities.length).toBe(doc.abilities.length);
    });

    it.skipIf(!hasFixture)("collection read/write round-trip preserves the array via itmEffectsCollection", () => {
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const effects = itmEffectsCollection.read(doc);
        const rebuilt = itmEffectsCollection.write(doc, effects);
        expect(rebuilt.effects.length).toBe(doc.effects.length);
    });
});

describe("ITM ability structure-ops with effect-slice relinking", () => {
    it.skipIf(!hasFixture)("the synthetic base has two abilities owning distinct, non-zero effect slices", () => {
        const doc = reparse(itmParser.serialize!(makeTwoAbilityBase()));
        expect(doc.abilities.length).toBe(2);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]);
        expect(doc.header.featureBlocksCount).toBe(0);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("add appends an empty-slice ability and leaves effects untouched", () => {
        const bytes = buildItmAddAbilityBytes(makeTwoAbilityBase(), ["Abilities"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.abilities[2]).toMatchObject({ featureBlockCount: 0 });
        // New empty slice sits at the end (running offset == effects.length).
        expect(doc.abilities[2]!.featureBlockIndex).toBe(3);
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove drops the ability and its owned effect slice; survivor re-anchors", () => {
        // Remove ability0 (1-based label "Ability 1"); its single effect (opcode 10) goes,
        // leaving ability1's two effects (20, 21) starting at the equipping-end index 0.
        const bytes = buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(1);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder down swaps abilities AND their adjacent effect slices", () => {
        // Move ability0 ("Ability 1") down: ability1 (slice [20,21]) now precedes
        // ability0 (slice [10]); the physical effect order proves the slice moved.
        const bytes = buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "down");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(2);
        // Slot 0 now owns the formerly-ability1 2-effect slice; slot 1 owns the 1-effect slice.
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(opcodes(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder up on the second ability mirrors reorder down on the first", () => {
        const bytes = buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "up");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(opcodes(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder at the boundary is a no-op (returns undefined)", () => {
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "up")).toBeUndefined();
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("duplicate clones the ability and its effect slice right after the source", () => {
        // Duplicate ability1 ("Ability 2", owns [20,21]); the clone + its cloned slice
        // are inserted right after the original slice (at s_k + c_k == 3).
        const bytes = buildItmDuplicateAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.effects.length).toBe(5);
        // Source slice (20,21) stays; clone (20,21) follows; ability0's single effect (10) leads.
        expect(opcodes(doc.effects)).toEqual([10, 20, 21, 20, 21]);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before adds an empty-slice ability at the slot; effects untouched", () => {
        const bytes = buildItmInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "before");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        // New empty ability at slot 0; the two real abilities keep their slices.
        expect(doc.abilities[0]).toMatchObject({ featureBlockCount: 0 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after adds an empty-slice ability after the slot; effects untouched", () => {
        const bytes = buildItmInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "after");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        // New empty ability at slot 1 (after ability0).
        expect(doc.abilities[1]).toMatchObject({ featureBlockCount: 0 });
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("rejects a non-ability path (returns undefined)", () => {
        expect(buildItmAddAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 99"])).toBeUndefined();
    });
});

describe("ITM effect structure-ops with owner-aware relinking", () => {
    it.skipIf(!hasFixture)("the equipping base lays out equipping + two abilities over [99,10,20,21]", () => {
        const doc = reparse(itmParser.serialize!(makeEquippingPlusTwoAbilityBase()));
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([99, 10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before an ability-owned effect grows that ability and shifts later ranges", () => {
        // "Effect 3" (1-based) is effects[2] (opcode 20), owned by ability1.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 3"], "before");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        // A default (opcode 0) effect lands before opcode 20.
        expect(opcodes(doc.effects)).toEqual([99, 10, 0, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 }); // equipping unchanged
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 3 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after an ability-owned effect grows that ability and shifts later ranges", () => {
        // "Effect 2" is effects[1] (opcode 10), the sole effect of ability0.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 2"], "after");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 0, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after the equipping effect grows the header and shifts all ability indices", () => {
        // "Effect 1" is effects[0] (opcode 99), the equipping effect.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 1"], "after");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 0, 10, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 2 });
        // Both abilities shift +1.
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert before the equipping effect grows the header and shifts all ability indices", () => {
        // "Effect 1" is effects[0] (opcode 99), the equipping effect. "before"
        // inserts at index 0; the equipping range absorbs the new effect and every
        // ability range shifts +1.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 1"], "before");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([0, 99, 10, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 2 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove an ability-owned effect shrinks that ability and shifts later ranges", () => {
        // "Effect 3" is effects[2] (opcode 20), the first of ability1's two effects.
        const bytes = buildItmRemoveEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 3"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21]); // opcode 20 gone
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove the equipping effect shrinks the header and shifts ability indices down", () => {
        // "Effect 1" is effects[0] (opcode 99), the equipping effect.
        const bytes = buildItmRemoveEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 1"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]); // opcode 99 gone
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 0 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)(
        "duplicate an ability-owned effect grows that ability and clones the opcode adjacently",
        () => {
            // "Effect 3" is effects[2] (opcode 20), owned by ability1.
            const bytes = buildItmDuplicateEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 3"]);
            expect(bytes).toBeDefined();
            const doc = reparse(bytes!);
            // The clone (opcode 20) lands right after the source.
            expect(opcodes(doc.effects)).toEqual([99, 10, 20, 20, 21]);
            expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
            expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
            expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 3 });
            expect(validateEffectPartition(doc)).toEqual([]);
        },
    );

    it.skipIf(!hasFixture)(
        "duplicate an equipping-owned effect grows the header and clones the opcode adjacently",
        () => {
            // "Effect 1" is effects[0] (opcode 99), the equipping effect.
            const bytes = buildItmDuplicateEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 1"]);
            expect(bytes).toBeDefined();
            const doc = reparse(bytes!);
            // The clone (opcode 99) lands right after the source; header count grows.
            expect(opcodes(doc.effects)).toEqual([99, 99, 10, 20, 21]);
            expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 2 });
            // Both abilities shift +1.
            expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
            expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
            expect(validateEffectPartition(doc)).toEqual([]);
        },
    );

    it.skipIf(!hasFixture)("the duplicated effect is a distinct object (deep clone, no aliasing)", () => {
        const base = makeEquippingPlusTwoAbilityBase();
        const doc = getItmCanonicalDocument(base) ?? rebuildItmCanonicalDocument(base);
        if (!doc) throw new Error("no canonical doc");
        const bytes = buildItmDuplicateEffectBytes(base, ["Effects", "Effect 3"]);
        expect(bytes).toBeDefined();
        const result = reparse(bytes!);
        // Two distinct effects carry opcode 20 (source + clone); reparse yields
        // separate objects, proving the clone is not the same reference.
        const twenties = result.effects.filter((e) => e.opcode === 20);
        expect(twenties.length).toBe(2);
        expect(twenties[0]).not.toBe(twenties[1]);
    });

    it.skipIf(!hasFixture)("reorder within the same owner swaps opcodes without changing counts or indices", () => {
        // ability1 owns effects[2,3] (opcodes 20, 21). Reorder "Effect 3" (opcode 20)
        // down swaps it with its same-owner neighbor opcode 21.
        const bytes = buildItmReorderEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 3"], "down");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder up mirrors reorder down within the same owner", () => {
        // "Effect 4" (opcode 21) up swaps with same-owner neighbor opcode 20.
        const bytes = buildItmReorderEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects", "Effect 4"], "up");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder across an owner boundary is rejected (returns undefined)", () => {
        // ability0 owns the single effect[1] (opcode 10). Reordering it "down"
        // would cross into ability1; "up" would cross into equipping. Both rejected.
        const base = makeEquippingPlusTwoAbilityBase;
        expect(buildItmReorderEffectBytes(base(), ["Effects", "Effect 2"], "down")).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects", "Effect 2"], "up")).toBeUndefined();
        // The equipping effect[0] has no lower neighbor and "down" crosses into ability0.
        expect(buildItmReorderEffectBytes(base(), ["Effects", "Effect 1"], "up")).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects", "Effect 1"], "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("rejects a non-effects path or out-of-range effect (returns undefined)", () => {
        const base = makeEquippingPlusTwoAbilityBase;
        expect(buildItmInsertEffectBytes(base(), ["Abilities", "Ability 1"], "before")).toBeUndefined();
        expect(buildItmRemoveEffectBytes(base(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveEffectBytes(base(), ["Effects", "Effect 99"])).toBeUndefined();
        expect(buildItmDuplicateEffectBytes(base(), ["Effects", "Effect 0"])).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects", "Effect 99"], "up")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("removes the first effect of an equipping-free real item without throwing", () => {
        // wm_sbook.itm has equipping count 0 and a single ability-owned effect.
        // Removing it drives the empty equipping range start to -1 under the raw
        // shift; the clamp keeps it at 0 so serialization succeeds (regression).
        const pr = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (pr.errors) throw new Error(pr.errors.join(", "));
        const before = getItmCanonicalDocument(pr) ?? rebuildItmCanonicalDocument(pr);
        if (!before) throw new Error("no canonical doc");
        expect(before.header.featureBlocksCount).toBe(0); // no equipping effects
        expect(before.effects.length).toBe(1); // single ability-owned effect

        const bytes = buildItmRemoveEffectBytes(pr, ["Effects", "Effect 1"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.effects.length).toBe(0);
        expect(validateEffectPartition(doc)).toEqual([]);
    });
});
