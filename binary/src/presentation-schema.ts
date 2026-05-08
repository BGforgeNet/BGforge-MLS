/**
 * Per-format presentation lookup. Type definitions and zod parser live in
 * `presentation-schema-types.ts`; per-format schema construction lives in
 * each format's `presentation-schema.ts`. This file routes lookups through
 * `formatAdapterRegistry`, so adding a new format means writing one
 * `<format>/presentation-schema.ts` and attaching it to that format's
 * adapter - no parallel registry to maintain here.
 */

import { formatAdapterRegistry } from "./format-adapter";
import {
    type CompiledPatternFieldPresentation,
    type FieldPresentation,
    type FormatPresentationSchema,
    type PatternFieldPresentation,
} from "./presentation-schema-types";

export type {
    FieldPresentation,
    FormatPresentationSchema,
    PatternFieldPresentation,
} from "./presentation-schema-types";

export function createFieldKey(segments: readonly string[]): string {
    return `/${segments.map((segment) => segment.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

export function toSemanticFieldKey(format: string, segments: readonly string[]): string | undefined {
    const adapter = formatAdapterRegistry.get(format);
    if (adapter) {
        return adapter.toSemanticFieldKey(segments);
    }
    return undefined;
}

export function createSemanticFieldKeyFromId(format: string, fieldId: string): string | undefined {
    try {
        const segments = JSON.parse(fieldId) as unknown;
        if (!Array.isArray(segments) || !segments.every((segment) => typeof segment === "string")) {
            return undefined;
        }
        return toSemanticFieldKey(format, segments);
    } catch {
        return undefined;
    }
}

function mergePresentation(base: FieldPresentation, override: FieldPresentation): FieldPresentation {
    return {
        ...base,
        ...override,
        enumOptions: override.enumOptions ?? base.enumOptions,
        flagOptions: override.flagOptions ?? base.flagOptions,
        flagActivation: override.flagActivation ?? base.flagActivation,
    };
}

function toFieldPresentation(entry: PatternFieldPresentation | CompiledPatternFieldPresentation): FieldPresentation {
    return {
        label: entry.label,
        presentationType: entry.presentationType,
        enumOptions: entry.enumOptions,
        flagOptions: entry.flagOptions,
        flagActivation: entry.flagActivation,
        numericFormat: entry.numericFormat,
        editable: entry.editable,
        stringCharset: entry.stringCharset,
    };
}

export function getFormatPresentationSchema(format: string): FormatPresentationSchema | undefined {
    return formatAdapterRegistry.get(format)?.presentationSchema;
}

export function resolveFieldPresentation(
    format: string,
    fieldKey: string,
    fieldName: string,
): FieldPresentation | undefined {
    const adapter = formatAdapterRegistry.get(format);
    const schema = adapter?.presentationSchema;
    if (!adapter || !schema) {
        return undefined;
    }

    let presentation: FieldPresentation = {};
    const patterns = adapter.compiledPatternFields ?? [];
    for (const entry of patterns) {
        if (!entry.pathRegex.test(fieldKey)) {
            continue;
        }
        if (entry.fieldNameRegex && !entry.fieldNameRegex.test(fieldName)) {
            continue;
        }
        presentation = mergePresentation(presentation, toFieldPresentation(entry));
    }

    const exact = schema.exactFields[fieldKey];
    if (exact) {
        presentation = mergePresentation(presentation, exact);
    }

    return Object.keys(presentation).length > 0 ? presentation : undefined;
}

export function toNumericOptionMap(options?: Record<string, string>): Record<number, string> | undefined {
    if (!options) {
        return undefined;
    }
    return Object.fromEntries(Object.entries(options).map(([key, value]) => [Number(key), value]));
}
