import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../src/itm/canonical-reader";
import { serializeItmCanonicalDocument } from "../src/itm/canonical-writer";
import {
    buildItmAddAbilityBytes,
    buildItmDuplicateAbilityBytes,
    buildItmInsertAbilityBytes,
    buildItmRemoveAbilityBytes,
    buildItmReorderAbilityBytes,
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

    it("a default ability appended to a real ITM round-trips with featureBlockCount 0", () => {
        if (!hasFixture) return;
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

    it("default effect round-trips when appended with a default ability that owns it", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        // Append a default effect to doc.effects and a new ability whose
        // featureBlockIndex points at it and featureBlockCount is 1.
        // This validates that the default effect serializes cleanly;
        // the real owner-relink is handled in Tasks 5/6.
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

    it("collection read/write round-trip preserves the array via itmAbilitiesCollection", () => {
        if (!hasFixture) return;
        const parsed = itmParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)));
        if (parsed.errors) throw new Error(parsed.errors.join(", "));
        const doc = getItmCanonicalDocument(parsed);
        if (!doc) throw new Error("no canonical doc");
        const abilities = itmAbilitiesCollection.read(doc);
        const rebuilt = itmAbilitiesCollection.write(doc, abilities);
        expect(rebuilt.abilities.length).toBe(doc.abilities.length);
    });

    it("collection read/write round-trip preserves the array via itmEffectsCollection", () => {
        if (!hasFixture) return;
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
    it("the synthetic base has two abilities owning distinct, non-zero effect slices", () => {
        if (!hasFixture) return;
        const doc = reparse(itmParser.serialize!(makeTwoAbilityBase()));
        expect(doc.abilities.length).toBe(2);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 1 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 1, featureBlockCount: 2 });
        expect(opcodes(doc.effects)).toEqual([10, 20, 21]);
        expect(doc.header.featureBlocksCount).toBe(0);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it("add appends an empty-slice ability and leaves effects untouched", () => {
        if (!hasFixture) return;
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

    it("remove drops the ability and its owned effect slice; survivor re-anchors", () => {
        if (!hasFixture) return;
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

    it("reorder down swaps abilities AND their adjacent effect slices", () => {
        if (!hasFixture) return;
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

    it("reorder up on the second ability mirrors reorder down on the first", () => {
        if (!hasFixture) return;
        const bytes = buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "up");
        expect(bytes).toBeDefined();
        const doc = reparse(bytes!);
        expect(doc.abilities[0]).toMatchObject({ featureBlockIndex: 0, featureBlockCount: 2 });
        expect(doc.abilities[1]).toMatchObject({ featureBlockIndex: 2, featureBlockCount: 1 });
        expect(opcodes(doc.effects)).toEqual([20, 21, 10]);
        expect(validateEffectPartition(doc)).toEqual([]);
    });

    it("reorder at the boundary is a no-op (returns undefined)", () => {
        if (!hasFixture) return;
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 1"], "up")).toBeUndefined();
        expect(buildItmReorderAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 2"], "down")).toBeUndefined();
    });

    it("duplicate clones the ability and its effect slice right after the source", () => {
        if (!hasFixture) return;
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

    it("insert before adds an empty-slice ability at the slot; effects untouched", () => {
        if (!hasFixture) return;
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

    it("insert after adds an empty-slice ability after the slot; effects untouched", () => {
        if (!hasFixture) return;
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

    it("rejects a non-ability path (returns undefined)", () => {
        if (!hasFixture) return;
        expect(buildItmAddAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Header", "Signature"])).toBeUndefined();
        expect(buildItmRemoveAbilityBytes(makeTwoAbilityBase(), ["Abilities", "Ability 99"])).toBeUndefined();
    });
});
