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

/** Case-insensitive substring filter over option labels, for the searchable combobox. Empty or
 * whitespace-only query returns all options unchanged. */
export function filterOptions(
    options: { value: number; label: string }[],
    query: string,
): { value: number; label: string }[] {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
}

/** Parses a query string as a decimal integer, returning the number or undefined.
 * Accepts only plain decimal integers (optional leading sign): "42", "-5", "+5", "0". Rejects hex
 * ("0xff"), decimals ("3.14"), and scientific notation ("1e2") uniformly via a strict regex.
 * Used by the combobox allowCustom mode. */
export function parseCustomValue(query: string): number | undefined {
    const s = query.trim();
    // Strict decimal-integer shape: optional sign then digits. This rejects hex/decimal/exponent forms
    // that Number() would otherwise coerce (e.g. "0xff" -> 255). Empty string fails the regex too.
    if (!/^[+-]?\d+$/.test(s)) return undefined;
    const n = Number(s);
    // Redundant safety net: the regex already guarantees a finite integer.
    if (!Number.isFinite(n) || !Number.isInteger(n)) return undefined;
    return n;
}
