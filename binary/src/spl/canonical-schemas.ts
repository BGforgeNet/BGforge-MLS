/**
 * Zod schemas and TypeScript types for the SPL canonical data model.
 * Mirrors the ITM canonical shape: header + flat abilities[] + flat effects[].
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import { splAbilitySpecAnnotated } from "./specs/ability.overrides";

const splHeaderSchemaStrict = toZodSchema(splHeaderSpecAnnotated, { mode: "strict" });
const splHeaderSchemaPermissive = toZodSchema(splHeaderSpecAnnotated, { mode: "permissive" });
const abilitySchemaStrict = toZodSchema(splAbilitySpecAnnotated, { mode: "strict" });
const abilitySchemaPermissive = toZodSchema(splAbilitySpecAnnotated, { mode: "permissive" });
const effectSchemaStrict = toZodSchema(effectSpecAnnotated, { mode: "strict" });
const effectSchemaPermissive = toZodSchema(effectSpecAnnotated, { mode: "permissive" });

export const splCanonicalDocumentSchema = z.strictObject({
    header: splHeaderSchemaStrict,
    abilities: z.array(abilitySchemaStrict),
    effects: z.array(effectSchemaStrict),
});

export const splCanonicalDocumentSchemaPermissive = z.strictObject({
    header: splHeaderSchemaPermissive,
    abilities: z.array(abilitySchemaPermissive),
    effects: z.array(effectSchemaPermissive),
});

export type SplCanonicalDocument = z.infer<typeof splCanonicalDocumentSchema>;

export const splCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("spl"),
    formatName: z.string().min(1),
    document: splCanonicalDocumentSchema,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export const splCanonicalSnapshotSchemaPermissive = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("spl"),
    formatName: z.string().min(1),
    document: splCanonicalDocumentSchemaPermissive,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export type SplCanonicalSnapshot = z.infer<typeof splCanonicalSnapshotSchema>;
