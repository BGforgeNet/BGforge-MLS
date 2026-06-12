import { isArraySpec, isCharsSpec, type StructSpec } from "./types";
import { humanize, slugify, type StructPresentation } from "./presentation";
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
    return literal.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    emit: (specKey: string, fieldKey: string, entry: PresentationEntry) => void,
): void {
    for (const key of Object.keys(spec) as (keyof T & string)[]) {
        const fs = spec[key];
        if (isCharsSpec(fs)) continue;
        const pres = presentation[key];
        // Key by the slugified display label, not the spec field name: the consumer (resolveFieldPresentation)
        // is called with the field's semantic key, which the walker builds as slugify(pres.label ?? humanize).
        // For a default label these coincide; for a custom label (idRequired -> "Identification") they diverge,
        // and only slugify(label) matches what the consumer looks up.
        const fieldKey = slugify(pres?.label ?? humanize(key));

        if (isArraySpec(fs)) {
            // A "slots" array (e.g. ITM usabilityFlags) renders as a subgroup whose children carry per-slot
            // enum/flags; mirror that as one entry per slot, keyed `${fieldKey}.${slugify(slotLabel)}`. Byte
            // reserves and slot arrays whose element has no enum/flags emit nothing.
            if (fs.view === "slots" && fs.slotLabels) {
                fs.slotLabels.forEach((slotLabel, i) => {
                    if (slotLabel === undefined) return;
                    const el = fs.slotElements?.[i] ?? fs.element;
                    const slotKey = `${fieldKey}.${slugify(slotLabel)}`;
                    if (el.enum) {
                        emit(key, slotKey, { presentationType: "enum", enumOptions: stringifyKeys(el.enum) });
                    } else if (el.flags) {
                        emit(key, slotKey, { presentationType: "flags", flagOptions: stringifyKeys(el.flags) });
                    }
                });
            }
            continue;
        }

        if (fs.enum) {
            emit(key, fieldKey, {
                ...(pres?.label !== undefined && { label: pres.label }),
                presentationType: "enum",
                enumOptions: stringifyKeys(fs.enum),
                // A packed/bitfield enum (declares `format: "hex32"`) carries the hex format so its value
                // prefix renders in hex everywhere the schema feeds, matching the walk path.
                ...(pres?.format === "hex32" && { numericFormat: "hex32" as const }),
            });
            continue;
        }

        if (fs.flags) {
            emit(key, fieldKey, {
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
            emit(key, fieldKey, overrides);
        }
    }
}

/** One walker subgroup: the slugified `name` becomes a path segment for the fields it wraps. */
export interface PresentationSubGroup {
    readonly name: string;
    readonly fields: readonly string[];
}

/**
 * Derive `presentation-schema.ts` `exactFields` entries from a `StructSpec` and `StructPresentation`. Output
 * keyed by `${prefix}.${slugify(label)}` so it matches the consumer's semantic key. `subGroups` mirrors the
 * walker's subgroup nesting (e.g. PRO drug "Affected Stats"): a field listed in a subgroup is keyed
 * `${prefix}.${slugify(subgroupName)}.${slugify(label)}`. See `emitPresentationEntries` for emit rules.
 */
export function toPresentationEntries<T>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    prefix: string,
    subGroups: readonly PresentationSubGroup[] = [],
): Record<string, PresentationEntry> {
    const groupOf = new Map<string, string>();
    for (const sg of subGroups) for (const f of sg.fields) groupOf.set(f, slugify(sg.name));
    const out: Record<string, PresentationEntry> = {};
    emitPresentationEntries(spec, presentation, (specKey, fieldKey, entry) => {
        const group = groupOf.get(specKey);
        out[group ? `${prefix}.${group}.${fieldKey}` : `${prefix}.${fieldKey}`] = entry;
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
    emitPresentationEntries(spec, presentation, (_specKey, fieldKey, entry) => {
        out.push({ pathPattern: `^${escapedPath}\\.${fieldKey}$`, ...entry });
    });
    return out;
}
