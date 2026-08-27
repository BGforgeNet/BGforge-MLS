/**
 * Shared helper for rebuilding an IE ability+effects canonical document
 * ({ header, abilities, effects }) from a display tree (ParseResult.root).
 *
 * Used by ITM and SPL canonical readers as the `rebuildFromDisplay` fallback
 * when `result.document` is absent (i.e. the editor has modified the display
 * tree and not yet re-parsed from bytes).
 *
 * `structFromDisplay` covers scalars and chars fields. Array fields with
 * `view: "slots"` (e.g. ITM header `usabilityFlags`, ITM ability
 * `meleeAnimation`) are emitted by `walkStruct` as a named sub-group whose
 * children carry a numeric `rawValue` per slot; this helper reads those
 * sub-groups and reconstructs the `number[]` canonical shape.
 */

import { structFromDisplay } from "../spec/walk-display";
import { humanize, type StructPresentation } from "../spec/presentation";
import { isArraySpec, type FieldSpec, type SpecData } from "../spec/types";
import { effectSpecAnnotated } from "./specs/effect.overrides";
import type { ParsedField, ParsedGroup, ParseResult } from "../types";

// -- Group-finding helpers ---------------------------------------------------

function isGroup(entry: ParsedField | ParsedGroup): entry is ParsedGroup {
    return "fields" in entry;
}

function getGroup(root: ParsedGroup, name: string): ParsedGroup {
    const found = root.fields.find((e): e is ParsedGroup => isGroup(e) && e.name === name);
    if (!found) {
        throw new Error(`Missing IE group: "${name}" in "${root.name}"`);
    }
    return found;
}

function getChildGroups(parent: ParsedGroup): ParsedGroup[] {
    return parent.fields.filter((e): e is ParsedGroup => isGroup(e));
}

// -- Struct rebuild ----------------------------------------------------------

/**
 * Rebuild a typed data struct from a `ParsedGroup` produced by `walkStruct`,
 * extending `structFromDisplay` to handle fixed-count array fields:
 *
 *   - `view: "slots"` arrays: `walkStruct` emits a named sub-group whose
 *     children carry the slot value in `rawValue`; these are read back field
 *     by field.
 *   - Plain padding arrays (no `view: "slots"`): `walkStruct` renders them as
 *     a single "(N values)" padding field; the original values are not
 *     recoverable from the display tree, so they are zero-filled. Callers are
 *     responsible for ensuring the affected fields are genuinely padding
 *     (reserved / unused) so the zero-fill is safe.
 *
 * All non-array fields are delegated to `structFromDisplay`.
 *
 * Exported so format-specific canonical readers (e.g. EFF) can share the
 * same array-handling logic without duplicating it.
 */
export function structFromDisplayFull<S extends Record<string, FieldSpec>>(
    group: ParsedGroup,
    spec: S,
    presentation: StructPresentation<SpecData<S>>,
): SpecData<S> {
    // Collect array-field keys that need special handling. Two kinds:
    //   - view:"slots" arrays: sub-group children carry per-slot values.
    //   - plain (no view) arrays: rendered as a single padding entry in the
    //     display tree; values are not recoverable, so they are zero-filled.
    const slotsKeys = new Set<string>();
    const paddingKeys = new Set<string>();
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isArraySpec(fs)) {
            if (fs.view === "slots") {
                slotsKeys.add(key);
            } else {
                paddingKeys.add(key);
            }
        }
    }
    const arrayKeys = new Set<string>([...slotsKeys, ...paddingKeys]);

    if (arrayKeys.size === 0) {
        // No array fields: delegate entirely to structFromDisplay.
        return structFromDisplay(group, spec, presentation);
    }

    // Build a reduced spec and group with array fields stripped, so
    // structFromDisplay handles everything else via its existing logic.
    const scalarSpec: Record<string, FieldSpec> = {};
    for (const key of Object.keys(spec)) {
        if (!arrayKeys.has(key)) {
            scalarSpec[key] = spec[key]!;
        }
    }

    // structFromDisplay only reads scalar+chars fields from the group and
    // skips sub-groups, so pass the original group directly; it won't try
    // to decode the array sub-groups.
    // cast: scalarSpec is a structurally-compatible subset of S and carries
    // the same keyof set minus the array keys; SpecData<typeof scalarSpec>
    // is assignment-compatible with SpecData<S> for the scalar keys, and
    // the presentation Partial<Record<keyof S, ...>> satisfies
    // Partial<Record<keyof scalarSpec, ...>> by subset. TS cannot prove
    // these structural relationships at the constraint level, so casts are
    // used to thread the types through the generic boundary.
    const partial = (
        structFromDisplay as (
            g: ParsedGroup,
            s: Record<string, FieldSpec>,
            p: StructPresentation<Record<string, unknown>>,
        ) => Record<string, unknown>
    )(group, scalarSpec, presentation);

    // Read each array field: slots from a named sub-group, plain padding by zero-fill.
    const presTyped = presentation as Record<string, { label?: string } | undefined>;
    for (const key of arrayKeys) {
        const fs = spec[key]!;
        if (!isArraySpec(fs)) continue; // narrowing only

        const presKey = key as keyof SpecData<S>;
        const label: string = presTyped[presKey as string]?.label ?? humanize(key);

        if (paddingKeys.has(key)) {
            // Plain padding array: display layer emits a single "(N values)"
            // field; the per-element values are not recoverable. Zero-fill.
            // Callers must ensure these fields are genuinely reserved/padding.
            const count = typeof fs.count === "number" ? fs.count : 0;
            partial[key] = Array.from({ length: count }, () => 0);
            continue;
        }

        const subGroup = group.fields.find((e): e is ParsedGroup => isGroup(e) && e.name === label);
        if (!subGroup) {
            throw new Error(
                `structFromDisplayFull: array field "${key}" expected sub-group "${label}" in "${group.name}" but none found.`,
            );
        }

        // Each slot child carries its value in rawValue (numeric) or value.
        // The canonical doc shape for a fixed-count u8/u16 array is number[].
        const slotFields = subGroup.fields.filter((e): e is ParsedField => !isGroup(e));
        partial[key] = slotFields.map((f) => {
            const raw = typeof f.rawValue === "number" ? f.rawValue : typeof f.value === "number" ? f.value : undefined;
            if (typeof raw !== "number") {
                throw new TypeError(
                    `structFromDisplayFull: slot field "${f.name}" in sub-group "${subGroup.name}" had no numeric rawValue/value.`,
                );
            }
            return raw;
        });
    }

    return partial as SpecData<S>;
}

// -- Public rebuild API ------------------------------------------------------

/** Per-format configuration for rebuildAbilityEffectsDocument. */
export interface AbilityEffectsRebuildConfig<HeaderData, AbilityData> {
    /** Short display label used in group names: "ITM" or "SPL". */
    readonly label: string;
    readonly headerSpec: Record<string, FieldSpec>;
    readonly abilitySpec: Record<string, FieldSpec>;
    readonly headerPresentation: StructPresentation<HeaderData>;
    readonly abilityPresentation: StructPresentation<AbilityData>;
}

/**
 * Rebuild the canonical `{ header, abilities, effects }` document from a
 * `ParseResult` whose display tree was produced by `createIeAbilityEffectsParser`.
 *
 * Does NOT run `parseWithSchemaValidation`; callers supply their own
 * permissive document schema for that boundary check, mirroring the pattern
 * each format's `rebuildFromDisplay` uses (parallel to
 * `rebuildMapCanonicalDocument` which does run validation inline, but MAP
 * has a single canonical reader that owns that step).
 */
export function rebuildAbilityEffectsDocument<HeaderData, AbilityData>(
    result: ParseResult,
    config: AbilityEffectsRebuildConfig<HeaderData, AbilityData>,
): { header: HeaderData; abilities: AbilityData[]; effects: unknown[] } {
    const { label, headerSpec, abilitySpec, headerPresentation, abilityPresentation } = config;

    // Root structure: `${label} File` > [header, abilities, effects] groups.
    const headerGroup = getGroup(result.root, `${label} Header`);
    const abilitiesGroup = getGroup(result.root, "Abilities");
    const effectsGroup = getGroup(result.root, "Effects");

    const header = structFromDisplayFull(headerGroup, headerSpec, headerPresentation) as HeaderData;

    const abilities = getChildGroups(abilitiesGroup).map(
        (g) => structFromDisplayFull(g, abilitySpec, abilityPresentation) as AbilityData,
    );

    // Effects use effectSpecAnnotated which is flat (scalars + one chars field);
    // structFromDisplay handles it fully.
    const effects = getChildGroups(effectsGroup).map((g) => structFromDisplay(g, effectSpecAnnotated, {}));

    return { header, abilities, effects };
}
