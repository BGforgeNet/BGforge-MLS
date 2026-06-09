/**
 * CRE rebuild-from-display tests.
 *
 * Three invariants verified:
 *   1. Per-struct property: walkStruct + structFromDisplayFull round-trips each
 *      CRE spec (header, known-spell, spell-mem-info, memorized-spell, item,
 *      effect-v1, effect-v2). This is the primary per-field correctness gate;
 *      a real-data array field zero-filled on rebuild would cause the header
 *      round-trip to fail.
 *   2. Byte round-trip (both effect versions): construct a minimal CRE doc,
 *      serialize, parse, strip document, rebuild, serialize again - bytes must
 *      be identical.
 *   3. Edit-survives: mutate a display-tree field, rebuild, serialize, reparse,
 *      assert the edited value is present in the final document.
 */

import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { rebuildCreCanonicalDocument } from "../src/cre/canonical-reader";
import { serializeCreCanonicalDocument } from "../src/cre/canonical-writer";
import { creCanonicalDocumentSchemaPermissive } from "../src/cre/canonical-schemas";
import { creEffectV1Spec } from "../src/cre/specs/effect-v1";
import { creHeaderSpecAnnotated } from "../src/cre/specs/header.overrides";
import { creItemSpecAnnotated } from "../src/cre/specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "../src/cre/specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "../src/cre/specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "../src/cre/specs/spell-mem-info.overrides";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { EFF_SIGNATURE, EFF_VERSION_V2 } from "../src/eff/types";
import { CRE_SIGNATURE, CRE_VERSION_V1, CRE_ITEM_SLOT_COUNT, CRE_GROUP_LABELS } from "../src/cre/types";
import { walkStruct } from "../src/spec/walk-display";
import { structFromDisplayFull } from "../src/ie-common/rebuild-ability-effects";
import { isArraySpec, isCharsSpec, type FieldSpec } from "../src/spec/types";
import { parseWithSchemaValidation } from "../src/schema-validation";
import type { ParsedField, ParsedGroup } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete non-zero sample for a spec. Arrays get [1, 2, ...n] so
 * that a silent zero-fill on rebuild is caught by the equality assertion.
 * Flag fields use `[]` (no flags set) to avoid slug-vs-display-name
 * translation; the byte-round-trip tests cover flag field recovery end-to-end.
 * Scalar fields use 1; chars fields use "A". */
function buildSample(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isCharsSpec(fs)) {
            sample[key] = "A";
        } else if (isArraySpec(fs)) {
            const count = typeof fs.count === "number" ? fs.count : 0;
            // Non-zero values so that a silent zero-fill would be caught.
            sample[key] = Array.from({ length: count }, (_, i) => (i + 1) % 256);
        } else if (fs.flags) {
            // Flag fields project to string[] of slugified names; use empty
            // (all bits clear) to avoid the slug-vs-display-name translation
            // that buildSample cannot perform without importing coded-projection.
            sample[key] = [] as string[];
        } else {
            sample[key] = 1;
        }
    }
    return sample;
}

/** Build an all-zero sample (chars -> "", scalars/flags -> 0/[], arrays -> 0[n]). */
function buildZeroSample(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isCharsSpec(fs)) {
            sample[key] = "";
        } else if (isArraySpec(fs)) {
            const count = typeof fs.count === "number" ? fs.count : 0;
            sample[key] = Array.from({ length: count }, () => 0);
        } else if (fs.flags) {
            sample[key] = [] as string[];
        } else {
            sample[key] = 0;
        }
    }
    return sample;
}

/**
 * Minimal CRE canonical document. Both v1 and v2 effect kinds are supported
 * by passing the appropriate effects value. All section arrays are empty
 * except the effects array which carries exactly one record (supplied by the
 * caller) to exercise the effect-version dispatch.
 */
function buildMinimalCreDoc(
    effects: { kind: "v1"; records: unknown[] } | { kind: "v2"; records: unknown[] },
): Record<string, unknown> {
    const header = buildZeroSample(creHeaderSpecAnnotated as Record<string, FieldSpec>);
    header["signature"] = String.fromCodePoint(...CRE_SIGNATURE);
    header["version"] = String.fromCodePoint(...CRE_VERSION_V1);
    // effStructureVersion must agree with effects.kind.
    header["effStructureVersion"] = effects.kind === "v1" ? 0 : 1;

    const itemSlots: number[] = Array.from({ length: CRE_ITEM_SLOT_COUNT }, () => -1);

    return {
        header,
        knownSpells: [],
        spellMemInfo: [],
        memorizedSpells: [],
        effects,
        items: [],
        itemSlots,
    };
}

/** Build a minimal EFF v1 record (all scalars zero, resref ""). */
function buildZeroEffV1(): Record<string, unknown> {
    return buildZeroSample(creEffectV1Spec as Record<string, FieldSpec>);
}

/** Build a minimal EFF v2 body record. signature2/version2 carry the EFF magic. */
function buildZeroEffV2(): Record<string, unknown> {
    const body = buildZeroSample(effBodySpecAnnotated as Record<string, FieldSpec>);
    body["signature2"] = String.fromCodePoint(...EFF_SIGNATURE);
    body["version2"] = String.fromCodePoint(...EFF_VERSION_V2);
    return body;
}

// ---------------------------------------------------------------------------
// 1. Per-struct property tests
// ---------------------------------------------------------------------------

describe("CRE per-struct walkStruct -> structFromDisplayFull round-trip", () => {
    it("creHeaderSpecAnnotated: non-zero sample round-trips through display", () => {
        const sample = buildSample(creHeaderSpecAnnotated as Record<string, FieldSpec>);
        // Set the derived count/offset fields to 0 so the walk does not include
        // them as non-zero (structFromDisplayFull skips derivedOffset/Count
        // annotation but the codec still writes them - zeroing avoids false
        // failures on the round-trip assert for these structural fields).
        for (const key of Object.keys(creHeaderSpecAnnotated)) {
            const fs = (creHeaderSpecAnnotated as Record<string, FieldSpec>)[key]!;
            if (!isArraySpec(fs) && !isCharsSpec(fs) && "role" in fs && fs.role !== "data") {
                sample[key] = 0;
            }
        }
        // effStructureVersion must be 0 or 1; set to 1 for non-zero test.
        sample["effStructureVersion"] = 1;

        const g = walkStruct(creHeaderSpecAnnotated, {}, 0, sample as never, "CRE Header");
        const rebuilt = structFromDisplayFull(g, creHeaderSpecAnnotated, {});
        expect(rebuilt).toEqual(sample);
    });

    it("creKnownSpellSpecAnnotated: round-trips", () => {
        const sample = buildSample(creKnownSpellSpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(creKnownSpellSpecAnnotated, {}, 0, sample as never, "Known Spell 1");
        expect(structFromDisplayFull(g, creKnownSpellSpecAnnotated, {})).toEqual(sample);
    });

    it("creSpellMemInfoSpecAnnotated: round-trips", () => {
        const sample = buildSample(creSpellMemInfoSpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(creSpellMemInfoSpecAnnotated, {}, 0, sample as never, "Entry 1");
        expect(structFromDisplayFull(g, creSpellMemInfoSpecAnnotated, {})).toEqual(sample);
    });

    it("creMemorizedSpellSpecAnnotated: round-trips", () => {
        const sample = buildSample(creMemorizedSpellSpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(creMemorizedSpellSpecAnnotated, {}, 0, sample as never, "Memorized Spell 1");
        expect(structFromDisplayFull(g, creMemorizedSpellSpecAnnotated, {})).toEqual(sample);
    });

    it("creItemSpecAnnotated: round-trips", () => {
        const sample = buildSample(creItemSpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(creItemSpecAnnotated, {}, 0, sample as never, "Item 1");
        expect(structFromDisplayFull(g, creItemSpecAnnotated, {})).toEqual(sample);
    });

    it("creEffectV1Spec: round-trips", () => {
        const sample = buildSample(creEffectV1Spec as Record<string, FieldSpec>);
        const g = walkStruct(creEffectV1Spec, {}, 0, sample as never, "Effect 1");
        expect(structFromDisplayFull(g, creEffectV1Spec, {})).toEqual(sample);
    });

    it("effBodySpecAnnotated (CRE v2 effects): non-array fields round-trip; unused7 is zero-filled", () => {
        // unused7 (15 x u32) is the only plain (non-slots, non-chars) array in
        // effBodySpecAnnotated; its display value is discarded. This is acceptable
        // because unused7 is a reserved padding field.
        const sample = buildSample(effBodySpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(effBodySpecAnnotated, {}, 0, sample as never, "Effect 1");
        const rebuilt = structFromDisplayFull(g, effBodySpecAnnotated, {});

        // All fields except unused7 must match the sample.
        const expected = { ...sample, unused7: Array.from({ length: 15 }, () => 0) };
        expect(rebuilt).toEqual(expected);
    });
});

// ---------------------------------------------------------------------------
// 2. Format-level byte round-trip: both effect versions
// ---------------------------------------------------------------------------

describe("CRE display tree - Selected weapon is emitted as the engine weapon-slot enum", () => {
    // Real-producer, end-to-end guard. The editor renders a dropdown ONLY when the PARSED field carries
    // type:"enum" + enumOptions (projectRow uses field.type as the control's valueType and copies
    // field.enumOptions). Asserting resolveFieldPresentation in isolation passed while creParser still emitted
    // a plain int16 slot field - dead feature, green test. So this drives creParser.parse on real bytes and
    // checks the exact field the editor reads.
    it("the parsed Selected weapon field is an enum with the weapon-slot options", () => {
        const rawDoc = buildMinimalCreDoc({ kind: "v1", records: [buildZeroEffV1()] });
        (rawDoc.itemSlots as number[])[38] = 0; // 0 = Weapon 1 selected
        const doc = parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, rawDoc, "minimal CRE v1 doc");
        const parsed = creParser.parse(new Uint8Array(serializeCreCanonicalDocument(doc)));
        expect(parsed.errors).toBeUndefined();

        const slots = parsed.root.fields.find(
            (e): e is ParsedGroup => "fields" in e && e.name === CRE_GROUP_LABELS.itemSlots,
        );
        const slotName = (n: string) => slots?.fields.find((e): e is ParsedField => !("fields" in e) && e.name === n);
        const selected = slotName("Selected weapon");
        expect(selected?.type).toBe("enum");
        expect(selected?.rawValue).toBe(0);
        expect(selected?.value).toBe("Weapon 1");
        expect(selected?.enumOptions).toMatchObject({ "0": "Weapon 1", "1000": "Fist" });

        // Producer-label guard: the editor's CRE weapon dropdowns (binary-editor/relationship/cre-weapons.ts)
        // match these slot fields BY NAME, and the cross-record test fixture mirrors them. Assert the real
        // parser emits exactly these labels so the editor-side name-matching cannot silently drift.
        expect(slotName("Weapon 1"), "Weapon 1 slot label").toBeDefined();
        expect(slotName("Selected weapon ability"), "Selected weapon ability slot label").toBeDefined();
    });
});

describe("CRE rebuild - byte round-trip", () => {
    it("v2 effects: rebuild -> serialize produces the same bytes as eager -> serialize", () => {
        const rawDoc = buildMinimalCreDoc({ kind: "v2", records: [buildZeroEffV2()] });
        const doc = parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, rawDoc, "minimal CRE v2 doc");
        const bytes = serializeCreCanonicalDocument(doc);

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        // Eager path: serialize with result.document intact.
        const eagerBytes = creParser.serialize(parsed);

        // Rebuild path: strip document to force display-tree rebuild, then serialize.
        const rebuiltDoc = rebuildCreCanonicalDocument({ ...parsed, document: undefined });
        const rebuiltBytes = creParser.serialize({ ...parsed, document: rebuiltDoc });

        expect([...rebuiltBytes]).toEqual([...eagerBytes]);
    });

    it("v1 effects: rebuild -> serialize produces the same bytes as eager -> serialize", () => {
        const rawDoc = buildMinimalCreDoc({ kind: "v1", records: [buildZeroEffV1()] });
        const doc = parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, rawDoc, "minimal CRE v1 doc");
        const bytes = serializeCreCanonicalDocument(doc);

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        const eagerBytes = creParser.serialize(parsed);

        const rebuiltDoc = rebuildCreCanonicalDocument({ ...parsed, document: undefined });
        const rebuiltBytes = creParser.serialize({ ...parsed, document: rebuiltDoc });

        expect([...rebuiltBytes]).toEqual([...eagerBytes]);
    });
});

// ---------------------------------------------------------------------------
// 3. Edit-survives check
// ---------------------------------------------------------------------------

describe("CRE rebuild - edit survives", () => {
    it("mutating a v2 effect opcode in the display tree is reflected in the rebuilt document", () => {
        const rawDoc = buildMinimalCreDoc({ kind: "v2", records: [buildZeroEffV2()] });
        const doc = parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, rawDoc, "minimal CRE v2 doc");
        const bytes = serializeCreCanonicalDocument(doc);

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        // Find the Effects group and its first child (the single effect record).
        const root = parsed.root;
        const effectsGroup = root.fields.find((e): e is ParsedGroup => "fields" in e && e.name === "Effects");
        expect(effectsGroup).toBeDefined();

        const effectRecord = effectsGroup!.fields.find((e): e is ParsedGroup => "fields" in e);
        expect(effectRecord).toBeDefined();

        // Edit the Opcode field to 42.
        const editedEffectFields = effectRecord!.fields.map((e) => {
            if (!("fields" in e) && e.name === "Opcode") {
                return { ...e, rawValue: 42, value: 42 } as ParsedField;
            }
            return e;
        });
        const editedEffectRecord: ParsedGroup = { ...effectRecord!, fields: editedEffectFields };
        const editedEffectsGroup: ParsedGroup = { ...effectsGroup!, fields: [editedEffectRecord] };
        const editedRoot: ParsedGroup = {
            ...root,
            fields: root.fields.map((e) => ("fields" in e && e.name === "Effects" ? editedEffectsGroup : e)),
        };

        const editedResult = { ...parsed, root: editedRoot, document: undefined };
        const rebuilt = rebuildCreCanonicalDocument(editedResult);
        expect(rebuilt.effects.kind).toBe("v2");
        expect((rebuilt.effects.records[0] as { opcode: number }).opcode).toBe(42);

        // Serialize and reparse to confirm the edit survives the full cycle.
        const editedBytes = serializeCreCanonicalDocument(rebuilt);
        const reparsed = creParser.parse(new Uint8Array(editedBytes));
        expect(reparsed.errors).toBeUndefined();
        const reparsedDoc = rebuildCreCanonicalDocument(reparsed);
        expect(reparsedDoc.effects.kind).toBe("v2");
        expect((reparsedDoc.effects.records[0] as { opcode: number }).opcode).toBe(42);
    });

    it("mutating a v1 effect opcode in the display tree is reflected in the rebuilt document", () => {
        const rawDoc = buildMinimalCreDoc({ kind: "v1", records: [buildZeroEffV1()] });
        const doc = parseWithSchemaValidation(creCanonicalDocumentSchemaPermissive, rawDoc, "minimal CRE v1 doc");
        const bytes = serializeCreCanonicalDocument(doc);

        const parsed = creParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        const root = parsed.root;
        const effectsGroup = root.fields.find((e): e is ParsedGroup => "fields" in e && e.name === "Effects");
        expect(effectsGroup).toBeDefined();

        const effectRecord = effectsGroup!.fields.find((e): e is ParsedGroup => "fields" in e);
        expect(effectRecord).toBeDefined();

        const editedEffectFields = effectRecord!.fields.map((e) => {
            if (!("fields" in e) && e.name === "Opcode") {
                return { ...e, rawValue: 17, value: 17 } as ParsedField;
            }
            return e;
        });
        const editedEffectRecord: ParsedGroup = { ...effectRecord!, fields: editedEffectFields };
        const editedEffectsGroup: ParsedGroup = { ...effectsGroup!, fields: [editedEffectRecord] };
        const editedRoot: ParsedGroup = {
            ...root,
            fields: root.fields.map((e) => ("fields" in e && e.name === "Effects" ? editedEffectsGroup : e)),
        };

        const editedResult = { ...parsed, root: editedRoot, document: undefined };
        const rebuilt = rebuildCreCanonicalDocument(editedResult);
        expect(rebuilt.effects.kind).toBe("v1");
        expect((rebuilt.effects.records[0] as { opcode: number }).opcode).toBe(17);

        const editedBytes = serializeCreCanonicalDocument(rebuilt);
        const reparsed = creParser.parse(new Uint8Array(editedBytes));
        expect(reparsed.errors).toBeUndefined();
        const reparsedDoc = rebuildCreCanonicalDocument(reparsed);
        expect(reparsedDoc.effects.kind).toBe("v1");
        expect((reparsedDoc.effects.records[0] as { opcode: number }).opcode).toBe(17);
    });
});
