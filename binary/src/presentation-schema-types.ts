/**
 * Type definitions for the per-format presentation schema.
 *
 * Lives in its own module so `BinaryFormatAdapter` can reference these types
 * without importing the runtime `presentation-schema.ts` (which itself
 * imports `formatAdapterRegistry`). One-direction type-only dependency:
 * `format-adapter.ts` → these types; runtime `presentation-schema.ts` →
 * `formatAdapterRegistry` (lookup) + these types.
 */

import { z } from "zod";

const numericFormatSchema = z.enum(["decimal", "hex32"]);
const flagActivationSchema = z.enum(["set", "clear", "equal"]);
const presentationOptionsSchema = z.record(z.string(), z.string());
const stringCharsetSchema = z.enum(["ascii-printable", "utf8"]);

export const fieldPresentationSchema = z.strictObject({
    label: z.string().min(1).optional(),
    presentationType: z.enum(["scalar", "enum", "flags"]).optional(),
    enumOptions: presentationOptionsSchema.optional(),
    flagOptions: presentationOptionsSchema.optional(),
    flagActivation: z.record(z.string(), flagActivationSchema).optional(),
    numericFormat: numericFormatSchema.optional(),
    editable: z.boolean().optional(),
    /**
     * Charset restriction for `string` field types. Defaults to "utf8" (any
     * value within the byte budget). Set to "ascii-printable" for fields
     * consumed by 1990s-era game engines that don't honour multi-byte
     * encodings — accepted bytes stay within the engine's documented input.
     */
    stringCharset: stringCharsetSchema.optional(),
});

export const patternFieldPresentationSchema = fieldPresentationSchema.extend({
    pathPattern: z.string().min(1),
    fieldNamePattern: z.string().min(1).optional(),
});

export const formatPresentationSchema = z.strictObject({
    schemaVersion: z.literal(1),
    format: z.string().min(1),
    exactFields: z.record(z.string(), fieldPresentationSchema),
    patternFields: z.array(patternFieldPresentationSchema),
});

export type FieldPresentation = z.infer<typeof fieldPresentationSchema>;
export type PatternFieldPresentation = z.infer<typeof patternFieldPresentationSchema>;
export type FormatPresentationSchema = z.infer<typeof formatPresentationSchema>;

export interface CompiledPatternFieldPresentation extends PatternFieldPresentation {
    readonly pathRegex: RegExp;
    readonly fieldNameRegex?: RegExp;
}

/** Compile a format's `patternFields` once at module load. */
export function compilePatternFields(
    patterns: readonly PatternFieldPresentation[],
): readonly CompiledPatternFieldPresentation[] {
    return patterns.map((entry) => ({
        ...entry,
        pathRegex: new RegExp(entry.pathPattern),
        fieldNameRegex: entry.fieldNamePattern ? new RegExp(entry.fieldNamePattern) : undefined,
    }));
}

/** Convert a numeric-keyed enum/flag table to a string-keyed shape suitable for the schema. */
export function stringifyKeys(table: Readonly<Record<number, string>>): Record<string, string> {
    return Object.fromEntries(Object.entries(table).map(([key, value]) => [String(key), value]));
}
