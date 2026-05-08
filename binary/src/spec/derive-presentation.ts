import { isArraySpec, isCharsSpec, type StructSpec } from "./types";
import type { StructPresentation } from "./presentation";
import { stringifyKeys } from "../presentation-schema-types";

interface PresentationEntry {
    readonly label?: string;
    readonly presentationType?: "scalar" | "enum" | "flags";
    readonly enumOptions?: Readonly<Record<string, string>>;
    readonly flagOptions?: Readonly<Record<string, string>>;
    readonly numericFormat?: "decimal" | "hex32";
    readonly editable?: boolean;
}

interface PatternEntry extends PresentationEntry {
    readonly pathPattern: string;
}

function regexEscape(literal: string): string {
    return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Walk the (spec, presentation) pair and emit one entry per scalar field
 * whose presentation differs from the walker's defaults. The caller decides
 * how the field's emit-key is built (flat `${prefix}.${field}` for
 * exactFields, or a regex pattern for patternFields), and how each entry is
 * collected.
 *
 * Emit rules:
 *  - `spec.enum` -> `presentationType: "enum"` + `enumOptions`.
 *  - `spec.flags` -> `presentationType: "flags"` + `flagOptions`.
 *  - Otherwise: emit only when the presentation carries an override the walker
 *    cannot infer from the spec (`numericFormat`, `editable`, explicit `label`),
 *    or when the spec's `role` is non-`"data"` (locks the field).
 *    `unit` is consumed by the walker and does not surface here.
 *  - Array and chars fields are skipped.
 *
 * Spec-declared `role` is the authoritative source for "this field is
 * derived, not user data". An explicit presentation `editable` override
 * wins (escape hatch for cases the role taxonomy doesn't yet cover);
 * otherwise a non-`"data"` role locks the field.
 */
function emitPresentationEntries<T>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    emit: (key: keyof T & string, entry: PresentationEntry) => void,
): void {
    for (const key of Object.keys(spec) as (keyof T & string)[]) {
        const fs = spec[key];
        if (isArraySpec(fs) || isCharsSpec(fs)) continue;
        const pres = presentation[key];

        if (fs.enum) {
            emit(key, {
                ...(pres?.label !== undefined && { label: pres.label }),
                presentationType: "enum",
                enumOptions: stringifyKeys(fs.enum),
            });
            continue;
        }

        if (fs.flags) {
            emit(key, {
                ...(pres?.label !== undefined && { label: pres.label }),
                presentationType: "flags",
                flagOptions: stringifyKeys(fs.flags),
            });
            continue;
        }

        const overrides: { numericFormat?: "decimal" | "hex32"; editable?: boolean } = {};
        if (pres?.format === "decimal" || pres?.format === "hex32") overrides.numericFormat = pres.format;
        if (pres?.editable !== undefined) overrides.editable = pres.editable;
        else if (fs.role !== undefined && fs.role !== "data") overrides.editable = false;
        if (Object.keys(overrides).length > 0) {
            emit(key, overrides);
        }
    }
}

/**
 * Derive `presentation-schema.ts` `exactFields` entries from a `StructSpec`
 * and `StructPresentation`. Output keyed by `${prefix}.${fieldName}`.
 * See `emitPresentationEntries` for emit rules.
 */
export function toPresentationEntries<T>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    prefix: string,
): Record<string, PresentationEntry> {
    const out: Record<string, PresentationEntry> = {};
    emitPresentationEntries(spec, presentation, (key, entry) => {
        out[`${prefix}.${key}`] = entry;
    });
    return out;
}

/**
 * Path-aware counterpart to `toPresentationEntries`. Used by formats whose
 * canonical paths nest through array indices (e.g., MAP's
 * `map.scripts[].extents[].slots[].localVarsOffset`) which the flat-prefix
 * `toPresentationEntries` shape cannot express.
 *
 * The `pathTemplate` carries the unescaped path including literal `[]`
 * markers (`map.scripts[].extents[].slots[]`); the helper regex-escapes it
 * and appends each emitted field name to produce a `^<path>\\.<field>$`
 * pattern. See `emitPresentationEntries` for emit rules.
 */
export function toPresentationPatterns<T>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    pathTemplate: string,
): PatternEntry[] {
    const escapedPath = regexEscape(pathTemplate);
    const out: PatternEntry[] = [];
    emitPresentationEntries(spec, presentation, (key, entry) => {
        out.push({ pathPattern: `^${escapedPath}\\.${key}$`, ...entry });
    });
    return out;
}
