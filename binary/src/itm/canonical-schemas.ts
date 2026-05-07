/**
 * Zod schemas and TypeScript types for the ITM canonical data model.
 *
 * Header + flat `abilities[]` (extended headers) + flat `effects[]` (feature
 * blocks). Per-ability effect ranges are stored on the header's index/count
 * fields; we don't nest the arrays. The wire format is one flat effects
 * region addressed by absolute index from both the header (equipping
 * effects) and per-ability index/count fields, so a flat canonical
 * representation matches the underlying data shape.
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";
import { itmAbilitySpecAnnotated } from "./specs/ability.overrides";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE } from "./types";
import { validateDerivedFields } from "../spec/types";

const itmHeaderSchemaStrict = toZodSchema(itmHeaderSpecAnnotated, { mode: "strict" });
const itmHeaderSchemaPermissive = toZodSchema(itmHeaderSpecAnnotated, { mode: "permissive" });
const abilitySchemaStrict = toZodSchema(itmAbilitySpecAnnotated, { mode: "strict" });
const abilitySchemaPermissive = toZodSchema(itmAbilitySpecAnnotated, { mode: "permissive" });
const effectSchemaStrict = toZodSchema(effectSpecAnnotated, { mode: "strict" });
const effectSchemaPermissive = toZodSchema(effectSpecAnnotated, { mode: "permissive" });

const itmCanonicalDocumentBaseSchema = z.strictObject({
    header: itmHeaderSchemaStrict,
    abilities: z.array(abilitySchemaStrict),
    effects: z.array(effectSchemaStrict),
});

/**
 * Strict-mode canonical-doc schema for ITM. On top of the per-struct strict
 * refinements, asserts that the header's role-tagged structural fields agree
 * with what the canonical writer would recompute from the doc shape (abilities
 * count, abilities/effects section offsets). Rejects hand-edited JSON
 * snapshots that smuggle stale or wrong pointers; the writer would silently
 * correct these on save, but a save-path validator should refuse rather
 * than rewrite.
 */
export const itmCanonicalDocumentSchema = itmCanonicalDocumentBaseSchema.superRefine((doc, ctx) => {
    const abilitiesOffset = ITM_HEADER_SIZE;
    const effectsOffset = abilitiesOffset + doc.abilities.length * ITM_ABILITY_SIZE;
    const mismatches = validateDerivedFields(itmHeaderSpecAnnotated, doc.header, {
        arrays: { abilities: doc.abilities },
        sectionOffsets: { abilities: abilitiesOffset, effects: effectsOffset },
    });
    for (const m of mismatches) {
        ctx.addIssue({
            code: "custom",
            path: ["header", m.field],
            message: `derived field "${m.field}" is ${m.actual} but the writer would compute ${m.expected}`,
        });
    }
});

export const itmCanonicalDocumentSchemaPermissive = z.strictObject({
    header: itmHeaderSchemaPermissive,
    abilities: z.array(abilitySchemaPermissive),
    effects: z.array(effectSchemaPermissive),
});

export type ItmCanonicalDocument = z.infer<typeof itmCanonicalDocumentSchema>;

export const itmCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("itm"),
    formatName: z.string().min(1),
    document: itmCanonicalDocumentSchema,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export const itmCanonicalSnapshotSchemaPermissive = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("itm"),
    formatName: z.string().min(1),
    document: itmCanonicalDocumentSchemaPermissive,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export type ItmCanonicalSnapshot = z.infer<typeof itmCanonicalSnapshotSchema>;
