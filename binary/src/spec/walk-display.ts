import { codecByteLength, codecNumericTypeName } from "./codec-meta";
import { flagDictToInt, intToFlagDict, type FlagDict } from "./coded-projection";
import { humanize, type FieldPresentation, type StructPresentation } from "./presentation";
import { stringifyKeys } from "../presentation-schema-types";
import {
    isArraySpec,
    isCharsSpec,
    type FieldSpec,
    type ScalarFieldSpec,
    type SpecData,
    type StructSpec,
} from "./types";
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
): SpecData<S> {
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
        if (isCharsSpec(fs)) {
            // Chars project as `string` in SpecData; walkGroup's numeric-only
            // contract doesn't cover them. Callers that need chars round-trip
            // through a typed-binary read instead.
            throw new Error(`walkGroup: chars field "${key}" is not supported; read the bytes through the codec.`);
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
        // Flag fields project to a named-bit dict; enum fields project to
        // `string | number` (skipping when `enumOpaque` is set). Display
        // tree carries the int via `rawValue`, so the round-trip is int →
        // projected → int.
        // Flag fields project to a named-bit dict in canonical-doc shape; the
        // display tree carries the int via `rawValue` so the round-trip is
        // int → dict → int through `intToFlagDict` / `flagDictToInt`.
        out[key] = fs.flags ? intToFlagDict(fs.flags, numeric, codecByteLength(fs.codec) * 8) : numeric;
    }
    return out as SpecData<S>;
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
export function walkStruct<TSpec, TData extends TSpec>(
    spec: StructSpec<TSpec>,
    presentation: StructPresentation<TSpec>,
    baseOffset: number,
    data: TData,
    groupName: string,
    options: WalkOptions = {},
): ParsedGroup {
    const keys = Object.keys(spec) as (keyof TSpec & string)[];

    let cursor = baseOffset;
    const builtFields = new Map<keyof TSpec & string, ParsedField | ParsedGroup>();
    let i = 0;
    while (i < keys.length) {
        const key = keys[i]!;
        const fs = spec[key];

        // Packed-field parts share one wire slot: all consecutive parts with
        // the same `packedAs` value report the slot's offset+size and the
        // cursor advances by the slot size once for the whole group. Spec
        // authors are responsible for grouping packed parts contiguously
        // (the typed-binary derivation enforces this at module load).
        // Chars and array fields never participate in packing.
        if (!isArraySpec(fs) && !isCharsSpec(fs) && fs.packedAs !== undefined) {
            const slot = fs.packedAs;
            const slotOffset = cursor;
            const slotSize = codecByteLength(fs.codec);
            let j = i;
            while (j < keys.length) {
                const k = keys[j]!;
                const f = spec[k];
                if (isArraySpec(f) || isCharsSpec(f) || f.packedAs !== slot) break;
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
        const groupFields: (ParsedField | ParsedGroup)[] = sg.fields.map((f) => {
            const pf = builtFields.get(f as keyof TSpec & string);
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

function fieldSize<T>(fs: FieldSpec, data: T, key: keyof T & string): number {
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
    if (isCharsSpec(fs)) {
        return fs.count;
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
): ParsedField | ParsedGroup {
    const baseLabel = pres?.label ?? humanize(name);
    const label = labelPrefix ? `${labelPrefix} ${baseLabel}` : baseLabel;

    if (isCharsSpec(fs)) {
        // Chars fields preserve all wire bytes (including NULs) in the
        // canonical string for round-trip safety. Display strips trailing
        // NULs so a NUL-padded resref like `"EFF\0\0\0\0\0"` reads as
        // `"EFF"`. Interior NULs (rare, in unused/garbage fields) stay
        // verbatim so the display reflects the actual byte content.
        const raw = typeof value === "string" ? value : String(value);
        const trimmed = raw.replace(/ +$/, "");
        return { name: label, value: trimmed, offset, size, type: "string" };
    }

    if (isArraySpec(fs)) {
        if (fs.view === "slots" && fs.slotLabels && Array.isArray(value)) {
            // Per-slot semantic labels: emit the array as a sub-group whose
            // children carry the slot label and the element's full presentation
            // (codec type, plus enum/flags from `fs.element` if declared).
            const elementSize = codecByteLength(fs.element.codec);
            const slotLabels = fs.slotLabels;
            const slotElements = fs.slotElements;
            const children: ParsedField[] = value.map((elementValue, i) => {
                const slotLabel = slotLabels[i] ?? `Slot ${i}`;
                const elementSpec = slotElements?.[i] ?? fs.element;
                return scalarFieldFor(slotLabel, elementSpec, offset + i * elementSize, elementSize, elementValue);
            });
            return { name: label, fields: children, expanded: false };
        }
        // Trailing reserves and other byte-array fields are presented as a
        // single "(N values)" summary row rather than N unrolled scalars;
        // the canonical doc carries the full array if a downstream tool
        // needs it.
        const summary = Array.isArray(value) ? `(${value.length} values)` : value;
        return { name: label, value: summary, offset, size, type: "padding" };
    }

    return scalarFieldFor(label, fs, offset, size, value, pres);
}

function scalarFieldFor(
    label: string,
    fs: ScalarFieldSpec,
    offset: number,
    size: number,
    value: unknown,
    pres?: FieldPresentation,
): ParsedField {
    if (fs.enum) {
        const resolved = fs.enum[value as number];
        return {
            name: label,
            value: resolved ?? `Unknown (${String(value)})`,
            offset,
            size,
            type: "enum",
            rawValue: value as number,
            enumOptions: stringifyKeys(fs.enum),
        };
    }

    if (fs.flags) {
        // Flag fields surface in canonical-doc as a named-bit dict, but
        // slot-element data still flows through here as raw `number` since the
        // enclosing array's wire shape is `number[]` (the per-slot flag
        // annotation is a presentation hint, not a structural change to the
        // array element type). Accept both shapes: dict → repack via
        // `flagDictToInt`, number → use directly.
        const numeric = typeof value === "number" ? value : flagDictToInt(fs.flags, value as FlagDict);
        const active = Object.entries(fs.flags)
            .filter(([bit]) => (numeric & Number(bit)) !== 0)
            .map(([, displayName]) => displayName);
        return {
            name: label,
            value: active.length > 0 ? active.join(", ") : "(none)",
            offset,
            size,
            type: "flags",
            rawValue: numeric,
            flagOptions: stringifyKeys(fs.flags),
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
