import { codecByteLength, codecNumericTypeName } from "./codec-meta";
import { humanize, type FieldPresentation, type StructPresentation } from "./presentation";
import { isArraySpec, type FieldSpec, type StructSpec } from "./types";
import type { ParsedField, ParsedGroup, ParsedFieldType } from "../types";

interface SubGroupSpec {
    readonly name: string;
    readonly fields: readonly string[];
    readonly expanded?: boolean;
}

interface WalkOptions {
    readonly subGroups?: readonly SubGroupSpec[];
    readonly expanded?: boolean;
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
    for (const key of keys) {
        const fs = spec[key];
        const size = fieldSize(fs);
        builtFields.set(key, fieldFor(key, fs, presentation[key], cursor, size, data[key]));
        cursor += size;
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

function fieldSize(fs: FieldSpec): number {
    if (isArraySpec(fs)) {
        if (typeof fs.count === "number") {
            return fs.count * codecByteLength(fs.element.codec);
        }
        throw new Error("lengthFrom arrays must be sized by the caller; not yet supported in walker.");
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
): ParsedField {
    const label = pres?.label ?? humanize(name);

    if (isArraySpec(fs)) {
        return { name: label, value, offset, size, type: "padding" };
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
