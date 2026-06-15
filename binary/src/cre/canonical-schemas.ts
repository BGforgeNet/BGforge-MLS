/**
 * Zod schemas for the CRE canonical data model.
 *
 * Effects use a `kind` discriminator because the engine writes either EFF v1
 * (0x30 bytes per record) or EFF v2 body (0x108 bytes per record) but never
 * mixes them in one file. The choice is decoded from header byte 0x33 and
 * carried verbatim on the canonical doc to avoid re-discovery on save.
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";
import {
    CRE_EFFECT_V1_SIZE,
    CRE_EFFECT_V2_SIZE,
    CRE_HEADER_SIZE,
    CRE_ITEM_SIZE,
    CRE_ITEM_SLOT_COUNT,
    CRE_KNOWN_SPELL_SIZE,
    CRE_MEMORIZED_SPELL_SIZE,
    CRE_SPELL_MEM_INFO_SIZE,
} from "./types";
import { validateDerivedFields } from "../spec/types";

const creHeaderSchemaStrict = toZodSchema(creHeaderSpecAnnotated, { mode: "strict" });
const creHeaderSchemaPermissive = toZodSchema(creHeaderSpecAnnotated, { mode: "permissive" });
const knownSpellStrict = toZodSchema(creKnownSpellSpecAnnotated, { mode: "strict" });
const knownSpellPermissive = toZodSchema(creKnownSpellSpecAnnotated, { mode: "permissive" });
const spellMemInfoStrict = toZodSchema(creSpellMemInfoSpecAnnotated, { mode: "strict" });
const spellMemInfoPermissive = toZodSchema(creSpellMemInfoSpecAnnotated, { mode: "permissive" });
const memorizedSpellStrict = toZodSchema(creMemorizedSpellSpecAnnotated, { mode: "strict" });
const memorizedSpellPermissive = toZodSchema(creMemorizedSpellSpecAnnotated, { mode: "permissive" });
const itemStrict = toZodSchema(creItemSpecAnnotated, { mode: "strict" });
const itemPermissive = toZodSchema(creItemSpecAnnotated, { mode: "permissive" });
const effectV1Strict = toZodSchema(effectSpecAnnotated, { mode: "strict" });
const effectV1Permissive = toZodSchema(effectSpecAnnotated, { mode: "permissive" });
const effectV2Strict = toZodSchema(effBodySpecAnnotated, { mode: "strict" });
const effectV2Permissive = toZodSchema(effBodySpecAnnotated, { mode: "permissive" });

const itemSlotsSchemaStrict = z
    .array(z.number().int().min(-0x8000).max(0x7fff))
    .length(CRE_ITEM_SLOT_COUNT)
    .describe(
        "40 i16 inventory-slot entries. Indices 0-37 are item-table indices (-1 = empty); index 38 is the selected-weapon slot index (1000 = fist); index 39 is the selected-weapon ability index.",
    );

const itemSlotsSchemaPermissive = z.array(z.number().int().min(-0x8000).max(0x7fff)).length(CRE_ITEM_SLOT_COUNT);

const effectsSchemaStrict = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("v1"), records: z.array(effectV1Strict) }),
    z.strictObject({ kind: z.literal("v2"), records: z.array(effectV2Strict) }),
]);

const effectsSchemaPermissive = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("v1"), records: z.array(effectV1Permissive) }),
    z.strictObject({ kind: z.literal("v2"), records: z.array(effectV2Permissive) }),
]);

const creCanonicalDocumentBaseSchema = z.strictObject({
    header: creHeaderSchemaStrict,
    knownSpells: z.array(knownSpellStrict),
    spellMemInfo: z.array(spellMemInfoStrict),
    memorizedSpells: z.array(memorizedSpellStrict),
    effects: effectsSchemaStrict,
    items: z.array(itemStrict),
    itemSlots: itemSlotsSchemaStrict,
});

/**
 * Compute the section offsets the writer would produce from the doc shape.
 * Used by both the strict-mode refinement (to flag stale offsets in
 * hand-edited snapshots) and the writer itself (single source of truth).
 */
export function computeCreSectionOffsets(doc: {
    readonly knownSpells: readonly unknown[];
    readonly spellMemInfo: readonly unknown[];
    readonly memorizedSpells: readonly unknown[];
    readonly effects: { readonly kind: "v1" | "v2"; readonly records: readonly unknown[] };
    readonly items: readonly unknown[];
}): {
    readonly knownSpells: number;
    readonly spellMemInfo: number;
    readonly memorizedSpells: number;
    readonly effects: number;
    readonly items: number;
    readonly itemSlots: number;
} {
    const effectSize = doc.effects.kind === "v1" ? CRE_EFFECT_V1_SIZE : CRE_EFFECT_V2_SIZE;
    const knownSpells = CRE_HEADER_SIZE;
    const spellMemInfo = knownSpells + doc.knownSpells.length * CRE_KNOWN_SPELL_SIZE;
    const memorizedSpells = spellMemInfo + doc.spellMemInfo.length * CRE_SPELL_MEM_INFO_SIZE;
    const effects = memorizedSpells + doc.memorizedSpells.length * CRE_MEMORIZED_SPELL_SIZE;
    const items = effects + doc.effects.records.length * effectSize;
    const itemSlots = items + doc.items.length * CRE_ITEM_SIZE;
    return { knownSpells, spellMemInfo, memorizedSpells, effects, items, itemSlots };
}

/**
 * `sectionOffsets` map for `enforceDerivedFields` / `validateDerivedFields`:
 * always include `itemSlots` (the fixed-width block's position is
 * constrained), and include each variable section only when it has at least
 * one record. Empty sections have a free header-offset value (different
 * tools emit different conventions); preserving the doc's existing value
 * via omission keeps real-world fixtures byte-exact through round-trip.
 */
export function nonEmptyCreSectionOffsets(
    doc: Parameters<typeof computeCreSectionOffsets>[0],
    offsets: ReturnType<typeof computeCreSectionOffsets>,
): Record<string, number> {
    const out: Record<string, number> = { itemSlots: offsets.itemSlots };
    if (doc.knownSpells.length > 0) out.knownSpells = offsets.knownSpells;
    if (doc.spellMemInfo.length > 0) out.spellMemInfo = offsets.spellMemInfo;
    if (doc.memorizedSpells.length > 0) out.memorizedSpells = offsets.memorizedSpells;
    if (doc.effects.records.length > 0) out.effects = offsets.effects;
    if (doc.items.length > 0) out.items = offsets.items;
    return out;
}

/** Strict-mode CRE canonical-doc schema: structural-field consistency check. */
export const creCanonicalDocumentSchema = creCanonicalDocumentBaseSchema.superRefine((doc, ctx) => {
    if (doc.itemSlots.length !== CRE_ITEM_SLOT_COUNT) {
        ctx.addIssue({
            code: "custom",
            path: ["itemSlots"],
            message: `itemSlots must have exactly ${CRE_ITEM_SLOT_COUNT} entries (got ${doc.itemSlots.length})`,
        });
        return;
    }
    const offsets = computeCreSectionOffsets(doc);
    // Header byte 0x33 must agree with the effects variant.
    const expectedVersion = doc.effects.kind === "v1" ? 0 : 1;
    if (doc.header.effStructureVersion !== expectedVersion) {
        ctx.addIssue({
            code: "custom",
            path: ["header", "effStructureVersion"],
            message: `header.effStructureVersion (${doc.header.effStructureVersion}) does not match effects.kind ("${doc.effects.kind}")`,
        });
    }
    const mismatches = validateDerivedFields(creHeaderSpecAnnotated, doc.header, {
        arrays: {
            knownSpells: doc.knownSpells,
            spellMemInfo: doc.spellMemInfo,
            memorizedSpells: doc.memorizedSpells,
            effects: doc.effects.records,
            items: doc.items,
        },
        sectionOffsets: nonEmptyCreSectionOffsets(doc, offsets),
    });
    for (const m of mismatches) {
        ctx.addIssue({
            code: "custom",
            path: ["header", m.field],
            message: `derived field "${m.field}" is ${m.actual} but the writer would compute ${m.expected}`,
        });
    }
});

export const creCanonicalDocumentSchemaPermissive = z.strictObject({
    header: creHeaderSchemaPermissive,
    knownSpells: z.array(knownSpellPermissive),
    spellMemInfo: z.array(spellMemInfoPermissive),
    memorizedSpells: z.array(memorizedSpellPermissive),
    effects: effectsSchemaPermissive,
    items: z.array(itemPermissive),
    itemSlots: itemSlotsSchemaPermissive,
});

export type CreCanonicalDocument = z.infer<typeof creCanonicalDocumentSchema>;
export type CreEffectsDocument = CreCanonicalDocument["effects"];

export const creCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("cre"),
    formatName: z.string().min(1),
    document: creCanonicalDocumentSchema,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export const creCanonicalSnapshotSchemaPermissive = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("cre"),
    formatName: z.string().min(1),
    document: creCanonicalDocumentSchemaPermissive,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export type CreCanonicalSnapshot = z.infer<typeof creCanonicalSnapshotSchema>;
