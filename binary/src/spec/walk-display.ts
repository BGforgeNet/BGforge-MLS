import { codecByteLength, codecNumericTypeName } from "./codec-meta";
import { humanize, type FieldPresentation, type StructPresentation } from "./presentation";
import { isArraySpec, type FieldSpec, type SpecData, type StructSpec } from "./types";
import type { ParsedField, ParsedGroup, ParsedFieldType } from "../types";

/**
 * Inverse of `walkStruct`: walk a `ParsedGroup` produced by the display
 * layer and rebuild the typed data object from it. Used by canonical
 * readers that previously routed each field through a hand-coded
 * `readFieldNumber(group, "Display Label")` lookup — instead the spec +
 * presentation declares the label/key mapping once, and this helper
 * uses it to extract the data.
 *
 * For scalar fields, prefers `rawValue` when present (enum/flags display
 * the resolved name in `value`; the number is in `rawValue`). For
 * pure-numeric fields, `value` holds the number directly. Array fields
 * are not handled here — callers walk the surrounding group structure
 * for those cases.
 *
 * Throws if a spec field's display label is missing from the group.
 */
export function walkGroup<S extends Record<string, FieldSpec>>(
    group: ParsedGroup,
    spec: S,
    presentation: StructPresentation<SpecData<S>>,
): { -readonly [K in keyof S]: number } {
    const byName = new Map<string, ParsedField>();
    for (const entry of group.fields) {
        if ("fields" in entry) continue; // sub-groups skipped; scalars only
        byName.set(entry.name, entry);
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isArraySpec(fs)) {
            throw new Error(
                `walkGroup: array field "${key}" is not supported; iterate the array group at the call site.`,
            );
        }
        const presKey = key as keyof SpecData<S>;
        const label = presentation[presKey]?.label ?? humanize(key);
        const found = byName.get(label);
        if (!found) {
            throw new Error(
                `walkGroup: field "${key}" expected display label "${label}" but no such field in "${group.name}".`,
            );
        }
        const numeric =
            typeof found.rawValue === "number"
                ? found.rawValue
                : typeof found.value === "number"
                  ? found.value
                  : undefined;
        if (typeof numeric !== "number") {
            throw new TypeError(
                `walkGroup: field "${key}" (label "${label}") in "${group.name}" had no numeric rawValue/value.`,
            );
        }
        out[key] = numeric;
    }
    return out as { -readonly [K in keyof S]: number };
}

interface SubGroupSpec {
    readonly name: string;
    readonly fields: readonly string[];
    readonly expanded?: boolean;
}

interface WalkOptions {
    readonly subGroups?: readonly SubGroupSpec[];
    readonly expanded?: boolean;
    /**
     * Prepended (with a separating space) to every emitted field's display
     * label. Use for per-iteration prefixes that the surrounding wrapper
     * group cannot supply — e.g. `"Entry 5"` for a script slot whose
     * sibling slots share the same field labels and need disambiguation
     * inside the wrapper group.
     */
    readonly labelPrefix?: string;
}

/**
 * Walk a `StructSpec` + `StructPresentation` and emit a `ParsedGroup` for the
 * binary-editor display tree. The replacement for hand-written `parseArmor` /
 * `parseWeapon` / etc. functions in `pro/index.ts`.
 *
 * Field ordering matches spec declaration order. Offsets are computed
 * cumulatively from `baseOffset` using each field's codec byte length.
 *
 * `subGroups` re-arranges the output: each sub-group's listed fields are
 * pulled out of the flat sequence and emitted as a single nested
 * `ParsedGroup` at the position of the sub-group's first listed field.
 * Non-grouped fields stay in declaration order around it.
 *
 * Field type, label, and value formatting derive from the spec + presentation:
 *   - `type`: `codecNumericTypeName(field.codec)` for scalars, `"enum"` /
 *     `"flags"` when the spec carries those tables, `"padding"` for arrays.
 *   - `name`: `presentation.label` ?? `humanize(fieldName)`.
 *   - `value`: raw number, with `unit: "%"` appended or `format: "hex32"`
 *     applied; enum/flags resolve through their lookup tables.
 */
export function walkStruct<T extends Record<string, unknown>>(
    spec: StructSpec<T>,
    presentation: StructPresentation<T>,
    baseOffset: number,
    data: T,
    groupName: string,
    options: WalkOptions = {},
): ParsedGroup {
    const keys = Object.keys(spec) as (keyof T & string)[];

    let cursor = baseOffset;
    const builtFields = new Map<keyof T & string, ParsedField>();
    let i = 0;
    while (i < keys.length) {
        const key = keys[i]!;
        const fs = spec[key];

        // Packed-field parts share one wire slot: all consecutive parts with
        // the same `packedAs` value report the slot's offset+size and the
        // cursor advances by the slot size once for the whole group. Spec
        // authors are responsible for grouping packed parts contiguously
        // (the typed-binary derivation enforces this at module load).
        if (!isArraySpec(fs) && fs.packedAs !== undefined) {
            const slot = fs.packedAs;
            const slotOffset = cursor;
            const slotSize = codecByteLength(fs.codec);
            let j = i;
            while (j < keys.length) {
                const k = keys[j]!;
                const f = spec[k];
                if (isArraySpec(f) || f.packedAs !== slot) break;
                builtFields.set(k, fieldFor(k, f, presentation[k], slotOffset, slotSize, data[k], options.labelPrefix));
                j++;
            }
            cursor += slotSize;
            i = j;
            continue;
        }

        const size = fieldSize(fs, data, key);
        builtFields.set(key, fieldFor(key, fs, presentation[key], cursor, size, data[key], options.labelPrefix));
        cursor += size;
        i++;
    }

    const grouped = new Set<string>();
    const groupAt = new Map<string, ParsedGroup>();
    for (const sg of options.subGroups ?? []) {
        const anchor = sg.fields[0];
        if (anchor === undefined) {
            throw new Error(`subGroup "${sg.name}" must list at least one field`);
        }
        const groupFields: ParsedField[] = sg.fields.map((f) => {
            const pf = builtFields.get(f as keyof T & string);
            if (!pf) {
                throw new Error(`subGroups references unknown field: ${f}`);
            }
            grouped.add(f);
            return pf;
        });
        groupAt.set(anchor, {
            name: sg.name,
            fields: groupFields,
            expanded: sg.expanded ?? false,
        });
    }

    const out: (ParsedField | ParsedGroup)[] = [];
    for (const key of keys) {
        const groupHere = groupAt.get(key);
        if (groupHere) {
            out.push(groupHere);
            continue;
        }
        if (!grouped.has(key)) {
            out.push(builtFields.get(key)!);
        }
    }

    return { name: groupName, fields: out, expanded: options.expanded ?? true };
}

function fieldSize<T extends Record<string, unknown>>(fs: FieldSpec, data: T, key: string): number {
    if (isArraySpec(fs)) {
        if (typeof fs.count === "number") {
            return fs.count * codecByteLength(fs.element.codec);
        }
        // lengthFrom: size from data[arrayKey].length × element bytes. The
        // count field's value is redundant here — array.length is the source
        // of truth (enforceLinkedCounts keeps the count field in sync).
        const arr = data[key];
        if (!Array.isArray(arr)) {
            throw new TypeError(`lengthFrom array "${key}" expected an array in data, got ${typeof arr}.`);
        }
        return arr.length * codecByteLength(fs.element.codec);
    }
    return codecByteLength(fs.codec);
}

function fieldFor(
    name: string,
    fs: FieldSpec,
    pres: FieldPresentation | undefined,
    offset: number,
    size: number,
    value: unknown,
    labelPrefix?: string,
): ParsedField {
    const baseLabel = pres?.label ?? humanize(name);
    const label = labelPrefix ? `${labelPrefix} ${baseLabel}` : baseLabel;

    if (isArraySpec(fs)) {
        // Trailing reserves and other byte-array fields are presented as a
        // single "(N values)" summary row rather than N unrolled scalars;
        // the canonical doc carries the full array if a downstream tool
        // needs it.
        const summary = Array.isArray(value) ? `(${value.length} values)` : value;
        return { name: label, value: summary, offset, size, type: "padding" };
    }

    if (fs.enum) {
        const resolved = fs.enum[value as number];
        return {
            name: label,
            value: resolved ?? `Unknown (${String(value)})`,
            offset,
            size,
            type: "enum",
            rawValue: value as number,
        };
    }

    if (fs.flags) {
        const numeric = value as number;
        const active = Object.entries(fs.flags)
            .filter(([bit]) => (numeric & Number(bit)) !== 0)
            .map(([, n]) => n);
        return {
            name: label,
            value: active.length > 0 ? active.join(", ") : "(none)",
            offset,
            size,
            type: "flags",
            rawValue: numeric,
        };
    }

    const typeName: ParsedFieldType = codecNumericTypeName(fs.codec);
    let displayValue: unknown = value;
    if (typeof value === "number") {
        if (pres?.unit === "%") displayValue = `${value}%`;
        else if (pres?.format === "hex32") displayValue = `0x${value.toString(16).padStart(8, "0")}`;
    }
    return {
        name: label,
        value: displayValue,
        offset,
        size,
        type: typeName,
        rawValue: typeof value === "number" ? value : undefined,
    };
}
