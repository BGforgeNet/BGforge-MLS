import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../src/itm/canonical-writer";
import {
    buildItmAddAbilityBytes,
    buildItmAddEffectBytes,
    buildItmAddEffectToAbilityBytes,
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
    validateEffectPartition,
} from "../src/itm/entity-ops";
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

/**
 * An ITM with one ability that owns NO effects and no equipping effects (zero
 * effects total) - the "effect-less item" empty state that 1.2a is about.
 */
function makeEmptyEffectsBase(): ParseResult {
    const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getItmCanonicalDocument(parsed) ?? rebuildItmCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");
    const base = {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
        abilities: [{ ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 0 }],
        effects: [],
    };
    const reparsed = itmParser.parse(serializeItmCanonicalDocument(base));
    if (reparsed.errors) throw new Error(`base reparse errors: ${reparsed.errors.join(", ")}`);
    return reparsed;
}

/**
 * ability0 owns effect[0] (opcode 10); ability1 is a PRE-EXISTING empty ability
 * (count 0, start 1). Used to prove per-ability add gives an effect-less ability
 * its first effect.
 */
function makeTrailingEmptyAbilityBase(): ParseResult {
    const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
    if (parsed.errors) throw new Error(parsed.errors.join(", "));
    const doc = getItmCanonicalDocument(parsed) ?? rebuildItmCanonicalDocument(parsed);
    if (!doc) throw new Error("no canonical doc");
    const base = {
        ...doc,
        header: { ...doc.header, featureBlocksIndex: 0, featureBlocksCount: 0 },
        abilities: [
            { ...defaultItmAbility(), featureBlockIndex: 0, featureBlockCount: 1 },
            { ...defaultItmAbility(), featureBlockIndex: 1, featureBlockCount: 0 },
        ],
        effects: [{ ...defaultItmEffect(), opcode: 10 }],
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

    it.skipIf(!hasFixture)("add appends an ability seeded with one effect (usable at once)", () => {
        const bytes = buildItmAddAbilityBytes(makeTwoAbilityBase(), ["Abilities"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        // The new ability is seeded with one default (opcode 0) effect at the tail so it is not an
        // effect-less dead end; its slice sits at the end (running offset == old effects.length).
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 1 });
        expect(opcodes(doc.effects)).toEqual([10, 20, 21, 0]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove drops the ability and its owned effect slice; survivor re-anchors", () => {
        // Remove ability0 (index 0); its single effect (opcode 10) goes,
        // leaving ability1's two effects (20, 21) starting at the equipping-end index 0.
        const bytes = buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(1);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder down swaps abilities AND their adjacent effect slices", () => {
        // Move ability0 (index 0) down: ability1 (slice [20,21]) now precedes
        // ability0 (slice [10]); the physical effect order proves the slice moved.
        const bytes = buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0, "down");
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
        const bytes = buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 1, "up");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(opcodes(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder at the boundary is a no-op (returns undefined)", () => {
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0, "up")).toBeUndefined();
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 1, "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("duplicate clones the ability and its effect slice right after the source", () => {
        // Duplicate ability1 (index 1, owns [20,21]); the clone + its cloned slice
        // are inserted right after the original slice (at s_k + c_k == 3).
        const bytes = buildItmDuplicateAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 1);
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

    it.skipIf(!hasFixture)("insert before adds an ability seeded with one effect at the slot", () => {
        const bytes = buildItmInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0, "before");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        // New seeded ability at slot 0 owns the new effect at index 0; the two real abilities shift up.
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([0, 10, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after adds an ability seeded with one effect after the slot", () => {
        const bytes = buildItmInsertAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0, "after");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities.length).toBe(3);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        // New seeded ability at slot 1 (after ability0) owns the new effect spliced after ability0's slice.
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[2]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([10, 0, 20, 21]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("rejects a non-ability path (returns undefined)", () => {
        expect(buildItmAddAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Header"], 0)).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 98)).toBeUndefined();
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
        // effects[2] (opcode 20), owned by ability1.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 2, "before");
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
        // effects[1] (opcode 10), the sole effect of ability0.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 1, "after");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 0, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("insert after the equipping effect grows the header and shifts all ability indices", () => {
        // effects[0] (opcode 99), the equipping effect.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 0, "after");
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
        // effects[0] (opcode 99), the equipping effect. "before" inserts at index 0;
        // the equipping range absorbs the new effect and every ability range shifts +1.
        const bytes = buildItmInsertEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 0, "before");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([0, 99, 10, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 2 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove an ability-owned effect shrinks that ability and shifts later ranges", () => {
        // effects[2] (opcode 20), the first of ability1's two effects.
        const bytes = buildItmRemoveEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 2);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21]); // opcode 20 gone
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("remove the equipping effect shrinks the header and shifts ability indices down", () => {
        // effects[0] (opcode 99), the equipping effect.
        const bytes = buildItmRemoveEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 0);
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
            // effects[2] (opcode 20), owned by ability1.
            const bytes = buildItmDuplicateEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 2);
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
            // effects[0] (opcode 99), the equipping effect.
            const bytes = buildItmDuplicateEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 0);
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
        const bytes = buildItmDuplicateEffectBytes(base, ["Effects"], 2);
        expect(bytes).toBeDefined();
        const result = reparse(bytes!);
        // Two distinct effects carry opcode 20 (source + clone); reparse yields
        // separate objects, proving the clone is not the same reference.
        const twenties = result.effects.filter((e) => e.opcode === 20);
        expect(twenties.length).toBe(2);
        expect(twenties[0]).not.toBe(twenties[1]);
    });

    it.skipIf(!hasFixture)("reorder within the same owner swaps opcodes without changing counts or indices", () => {
        // ability1 owns effects[2,3] (opcodes 20, 21). Reorder effects[2] (opcode 20)
        // down swaps it with its same-owner neighbor opcode 21.
        const bytes = buildItmReorderEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 2, "down");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder up mirrors reorder down within the same owner", () => {
        // effects[3] (opcode 21) up swaps with same-owner neighbor opcode 20.
        const bytes = buildItmReorderEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"], 3, "up");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 10, 21, 20]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("reorder across an owner boundary is rejected (returns undefined)", () => {
        // ability0 owns the single effect[1] (opcode 10). Reordering it "down"
        // would cross into ability1; "up" would cross into equipping. Both rejected.
        const base = makeEquippingPlusTwoAbilityBase;
        expect(buildItmReorderEffectBytes(base(), ["Effects"], 1, "down")).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects"], 1, "up")).toBeUndefined();
        // The equipping effect[0] has no lower neighbor and "down" crosses into ability0.
        expect(buildItmReorderEffectBytes(base(), ["Effects"], 0, "up")).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects"], 0, "down")).toBeUndefined();
    });

    it.skipIf(!hasFixture)("rejects a non-effects path or out-of-range effect (returns undefined)", () => {
        const base = makeEquippingPlusTwoAbilityBase;
        expect(buildItmInsertEffectBytes(base(), ["Abilities"], 0, "before")).toBeUndefined();
        expect(buildItmRemoveEffectBytes(base(), ["Header"], 0)).toBeUndefined();
        expect(buildItmRemoveEffectBytes(base(), ["Effects"], 98)).toBeUndefined();
        expect(buildItmDuplicateEffectBytes(base(), ["Effects"], -1)).toBeUndefined();
        expect(buildItmReorderEffectBytes(base(), ["Effects"], 98, "up")).toBeUndefined();
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

        const bytes = buildItmRemoveEffectBytes(pr, ["Effects"], 0);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.effects.length).toBe(0);
        expect(validateEffectPartition(doc)).toEqual([]);
    });
});

describe("ITM effect add (section + per-ability)", () => {
    it.skipIf(!hasFixture)("section add appends a new effect to the equipping (global) range", () => {
        // The flat-list toolbar "+ add": a new effect with no ability is a global/equipping effect.
        // Equipping range is [0,1) over [99,...], so the new opcode-0 effect lands at index 1.
        const bytes = buildItmAddEffectBytes(makeEquippingPlusTwoAbilityBase(), ["Effects"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([99, 0, 10, 20, 21]);
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 2 });
        // Both abilities shift +1 to make room for the new equipping effect.
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 3, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("section add creates the FIRST effect on an effect-less item (1.2a)", () => {
        const bytes = buildItmAddEffectBytes(makeEmptyEffectsBase(), ["Effects"]);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([0]); // a single default effect, owned by equipping
        expect(doc.header).toMatchObject({ featureBlocksIndex: 0, featureBlocksCount: 1 });
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 0 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("per-ability add appends to that ability's slice and shifts later ranges", () => {
        // ability0 owns [10] at [0,1). Adding to ability0 appends a default effect at its end (index 1).
        const bytes = buildItmAddEffectToAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 0);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([10, 0, 20, 21]);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 2 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("per-ability add gives a PRE-EXISTING empty ability its first effect", () => {
        // ability1 is empty (count 0, start 1). Adding to it appends a default effect at index 1.
        const bytes = buildItmAddEffectToAbilityBytes(makeTrailingEmptyAbilityBase(), ["Abilities"], 1);
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(opcodes(doc.effects)).toEqual([10, 0]);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 1 });
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it.skipIf(!hasFixture)("rejects bad paths / out-of-range ability (returns undefined)", () => {
        expect(buildItmAddEffectBytes(makeTwoAbilityBase(), ["Abilities"])).toBeUndefined();
        expect(buildItmAddEffectToAbilityBytes(makeTwoAbilityBase(), ["Effects"], 0)).toBeUndefined();
        expect(buildItmAddEffectToAbilityBytes(makeTwoAbilityBase(), ["Abilities"], 98)).toBeUndefined();
    });
});
