/**
 * Zod schemas and TypeScript types for the EFF canonical data model.
 * Fixed shape: header + body. No nested arrays.
 */

import { z } from "zod";
import { toZodSchema } from "../spec/derive-zod";
import { opaqueRangeSchema } from "../shared-schemas";
import { effBodySpecAnnotated } from "./specs/body.overrides";
import { effHeaderSpec } from "./specs/header";

const effHeaderSchemaStrict = toZodSchema(effHeaderSpec, { mode: "strict" });
const effHeaderSchemaPermissive = toZodSchema(effHeaderSpec, { mode: "permissive" });
const effBodySchemaStrict = toZodSchema(effBodySpecAnnotated, { mode: "strict" });
const effBodySchemaPermissive = toZodSchema(effBodySpecAnnotated, { mode: "permissive" });

export const effCanonicalDocumentSchema = z.strictObject({
    header: effHeaderSchemaStrict,
    body: effBodySchemaStrict,
});

export const effCanonicalDocumentSchemaPermissive = z.strictObject({
    header: effHeaderSchemaPermissive,
    body: effBodySchemaPermissive,
});

export type EffCanonicalDocument = z.infer<typeof effCanonicalDocumentSchema>;

export const effCanonicalSnapshotSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("eff"),
    formatName: z.string().min(1),
    document: effCanonicalDocumentSchema,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export const effCanonicalSnapshotSchemaPermissive = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.literal("eff"),
    formatName: z.string().min(1),
    document: effCanonicalDocumentSchemaPermissive,
    opaqueRanges: z.array(opaqueRangeSchema).optional(),
    warnings: z.array(z.string()).optional(),
    errors: z.array(z.string()).optional(),
});

export type EffCanonicalSnapshot = z.infer<typeof effCanonicalSnapshotSchema>;
