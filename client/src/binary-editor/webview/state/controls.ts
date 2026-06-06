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
    /** The bit MASK (e.g. 0x2, 0x40), not a bit index - flag tables are mask-keyed (see decomposeFlags). */
    mask: number;
    label: string;
    set: boolean;
}

/**
 * Decompose a flags field into its toggle states. `row.flagOptions` is keyed by the bit MASK
 * (`stringifyKeys(fs.flags)`, where every PRO/IE flag table maps a single-bit mask -> name, e.g.
 * `{ "2": "Barter", "32": "NoSteal" }`) - NOT by bit index. So a flag is set when `raw & mask` is
 * nonzero; the mask is used directly, never `1 << key`. (Matches the mask semantics walkStruct uses to
 * build the display string and `intToFlagArray` uses for the canonical projection.)
 */
export function decomposeFlags(row: Row): FlagBit[] {
    const raw = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0);
    return Object.entries(row.flagOptions ?? {})
        .map(([k, label]) => ({ mask: Number(k), label }))
        .sort((a, b) => a.mask - b.mask)
        .map(({ mask, label }) => ({ mask, label, set: (raw & mask) !== 0 }));
}

/** Set or clear `mask` in `current`. `>>> 0` keeps the result an unsigned 32-bit value so high-bit
 *  masks (e.g. 0x80000000) do not produce a negative number from JS signed bitwise ops. */
export function composeFlags(current: number, mask: number, set: boolean): number {
    const next = set ? current | mask : current & ~mask;
    // `>>> 0` is unsigned-32-bit coercion (not truncation): it maps a negative signed result from the
    // high-bit bitwise ops back to its unsigned value. Math.trunc would leave it negative - not equivalent.
    // eslint-disable-next-line unicorn/prefer-math-trunc
    return next >>> 0;
}

/** Above this many options the searchable combobox beats scrolling through a plain select. */
export const ENUM_SEARCH_THRESHOLD = 12;

/** Returns true when an enum field has enough options that type-to-search is preferable to a plain select. */
export function isLargeEnum(optionCount: number): boolean {
    return optionCount > ENUM_SEARCH_THRESHOLD;
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
