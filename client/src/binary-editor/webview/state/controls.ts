import type { Row } from "@bgforge/binary-editor";

export type ControlKind = "number" | "string" | "enum" | "flags";

export function controlKind(row: Row): ControlKind {
    if (row.valueType === "enum" && row.enumOptions) return "enum";
    if (row.valueType === "flags" && row.flagOptions) return "flags";
    if (row.valueType === "string") return "string";
    return "number";
}

export interface EnumOption {
    value: number;
    label: string;
}

export function enumOptionList(row: Row): EnumOption[] {
    const opts = Object.entries(row.enumOptions ?? {}).map(([k, label]) => ({ value: Number(k), label }));
    const raw = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue);
    if (Number.isFinite(raw) && !opts.some((o) => o.value === raw)) {
        opts.push({ value: raw, label: `Unknown (${raw})` });
    }
    return opts.sort((a, b) => a.value - b.value);
}

export interface FlagBit {
    bit: number;
    label: string;
    set: boolean;
}

export function decomposeFlags(row: Row): FlagBit[] {
    const raw = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0);
    return Object.entries(row.flagOptions ?? {})
        .map(([k, label]) => ({ bit: Number(k), label }))
        .sort((a, b) => a.bit - b.bit)
        .map(({ bit, label }) => ({ bit, label, set: (raw & (1 << bit)) !== 0 }));
}

export function composeFlags(current: number, bit: number, set: boolean): number {
    return set ? current | (1 << bit) : current & ~(1 << bit);
}
