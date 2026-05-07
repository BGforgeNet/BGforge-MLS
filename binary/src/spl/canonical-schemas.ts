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
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE } from "./types";
import { validateDerivedFields } from "../spec/types";

const splHeaderSchemaStrict = toZodSchema(splHeaderSpecAnnotated, { mode: "strict" });
const splHeaderSchemaPermissive = toZodSchema(splHeaderSpecAnnotated, { mode: "permissive" });
const abilitySchemaStrict = toZodSchema(splAbilitySpecAnnotated, { mode: "strict" });
const abilitySchemaPermissive = toZodSchema(splAbilitySpecAnnotated, { mode: "permissive" });
const effectSchemaStrict = toZodSchema(effectSpecAnnotated, { mode: "strict" });
const effectSchemaPermissive = toZodSchema(effectSpecAnnotated, { mode: "permissive" });

const splCanonicalDocumentBaseSchema = z.strictObject({
    header: splHeaderSchemaStrict,
    abilities: z.array(abilitySchemaStrict),
    effects: z.array(effectSchemaStrict),
});

/** Strict-mode SPL canonical-doc schema: structural-field consistency check. See ITM counterpart. */
export const splCanonicalDocumentSchema = splCanonicalDocumentBaseSchema.superRefine((doc, ctx) => {
    const abilitiesOffset = SPL_HEADER_SIZE;
    const effectsOffset = abilitiesOffset + doc.abilities.length * SPL_ABILITY_SIZE;
    const mismatches = validateDerivedFields(splHeaderSpecAnnotated, doc.header, {
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
