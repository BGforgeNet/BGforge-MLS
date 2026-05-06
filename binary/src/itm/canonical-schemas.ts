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
import { effectSpec } from "../ie-common/specs";
import { itmHeaderSpec } from "./specs/header";
import { itmAbilitySpec } from "./specs/ability";

const itmHeaderSchemaStrict = toZodSchema(itmHeaderSpec, { mode: "strict" });
const itmHeaderSchemaPermissive = toZodSchema(itmHeaderSpec, { mode: "permissive" });
const abilitySchemaStrict = toZodSchema(itmAbilitySpec, { mode: "strict" });
const abilitySchemaPermissive = toZodSchema(itmAbilitySpec, { mode: "permissive" });
const effectSchemaStrict = toZodSchema(effectSpec, { mode: "strict" });
const effectSchemaPermissive = toZodSchema(effectSpec, { mode: "permissive" });

export const itmCanonicalDocumentSchema = z.strictObject({
    header: itmHeaderSchemaStrict,
    abilities: z.array(abilitySchemaStrict),
    effects: z.array(effectSchemaStrict),
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
