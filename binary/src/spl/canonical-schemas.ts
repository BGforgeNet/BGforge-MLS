/**
 * Zod schemas and TypeScript types for the SPL canonical data model.
 * Mirrors the ITM canonical shape: header + flat abilities[] + flat effects[].
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { effectSpec } from "../ie-common/specs";
import { splHeaderSpec } from "./specs/header";
import { splAbilitySpec } from "./specs/ability";

const splHeaderSchemaStrict = toZodSchema(splHeaderSpec, { mode: "strict" });
const splHeaderSchemaPermissive = toZodSchema(splHeaderSpec, { mode: "permissive" });
const abilitySchemaStrict = toZodSchema(splAbilitySpec, { mode: "strict" });
const abilitySchemaPermissive = toZodSchema(splAbilitySpec, { mode: "permissive" });
const effectSchemaStrict = toZodSchema(effectSpec, { mode: "strict" });
const effectSchemaPermissive = toZodSchema(effectSpec, { mode: "permissive" });

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
