import { isArraySpec, isCharsSpec, type StructSpec } from "./types";
import type { StructPresentation } from "./presentation";

interface PresentationEntry {
    readonly label?: string;
    readonly presentationType?: "scalar" | "enum" | "flags";
    readonly enumOptions?: Readonly<Record<string, string>>;
    readonly flagOptions?: Readonly<Record<string, string>>;
    readonly numericFormat?: "decimal" | "hex32";
    readonly editable?: boolean;
}

/**
 * Derive `presentation-schema.ts` `exactFields` entries from a `StructSpec`
 * and `StructPresentation`. Output keyed by `${prefix}.${fieldName}`.
 *
 * - `spec.enum` → `presentationType: "enum"` with `enumOptions`.
 * - `spec.flags` → `presentationType: "flags"` with `flagOptions`.
 * - Otherwise: emit only when the presentation carries an override the walker
 *   cannot infer from the spec (`numericFormat`, `editable`, explicit `label`).
 *   `unit` is consumed by the walker and does not surface here.
 *
 * Array fields are not emitted.
 */
export function toPresentationEntries<T>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    prefix: string,
): Record<string, PresentationEntry> {
    const out: Record<string, PresentationEntry> = {};
    for (const key of Object.keys(spec) as (keyof T & string)[]) {
        const fs = spec[key];
        if (isArraySpec(fs) || isCharsSpec(fs)) continue;
        const pres = presentation[key];
        const fullKey = `${prefix}.${key}`;

        if (fs.enum) {
            const entry: PresentationEntry = {
                ...(pres?.label !== undefined && { label: pres.label }),
                presentationType: "enum",
                enumOptions: stringifyKeys(fs.enum),
            };
            out[fullKey] = entry;
            continue;
        }

        if (fs.flags) {
            const entry: PresentationEntry = {
                ...(pres?.label !== undefined && { label: pres.label }),
                presentationType: "flags",
                flagOptions: stringifyKeys(fs.flags),
            };
            out[fullKey] = entry;
            continue;
        }

        const overrides: { numericFormat?: "decimal" | "hex32"; editable?: boolean } = {};
        if (pres?.format === "decimal" || pres?.format === "hex32") overrides.numericFormat = pres.format;
        // Spec-declared `role` is the authoritative source for "this field is
        // derived, not user data". An explicit presentation `editable` override
        // wins (escape hatch for cases the role taxonomy doesn't yet cover);
        // otherwise a non-`"data"` role locks the field.
        if (pres?.editable !== undefined) overrides.editable = pres.editable;
        else if (fs.role !== undefined && fs.role !== "data") overrides.editable = false;
        if (Object.keys(overrides).length > 0) {
            out[fullKey] = overrides;
        }
    }
    return out;
}

function stringifyKeys(table: Readonly<Record<number, string>>): Record<string, string> {
    return Object.fromEntries(Object.entries(table).map(([k, v]) => [String(k), v]));
}
