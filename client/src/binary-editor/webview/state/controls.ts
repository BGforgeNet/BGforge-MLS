import type { Row } from "@bgforge/binary-editor";

export type ControlKind = "number" | "string" | "enum" | "flags";

export function controlKind(row: Row): ControlKind {
    if (row.valueType === "enum" && row.enumOptions) return "enum";
    if (row.valueType === "flags" && row.flagOptions) return "flags";
    // `padding`/`note` carry a text summary (e.g. a reserved array shows "(15 values)"); render as a
    // (read-only) string so the summary shows, instead of falling through to a number input that can't
    // display the string and renders as a blank box - which left the field looking like a bare label.
    if (row.valueType === "string" || row.valueType === "padding" || row.valueType === "note") return "string";
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

// The searchable Combobox primitive relies on these two helpers. No enum control uses the combobox today
// (enums are spec-driven Selects, with bits-ui typeahead, regardless of option count), but the primitive is
// kept available for a field that explicitly opts into search via the spec - e.g. an IE effect-opcode list
// with hundreds of options where a plain dropdown is unwieldy. That opt-in would be a spec/presentation
// flag, never an option-count threshold.

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

// ---- value-field width tiers ----
// Classify a value control into a SMALL fixed set of display-width tiers (S/M/L) keyed to the characters a
// value RENDERS, not its byte size. The tier maps to a box width in CSS (.field-control.tier-{s,m,l} ->
// --val-ch); the grid track is fixed so columns stay aligned and the tier only sets the control's width
// within it. This is the only piece that must live in code: the tier depends on the field's char-array
// length / hex format / longest dropdown label, none of which a CSS selector can read. It runs once per
// field render (a few comparisons), not per frame. See the UX rule "Size fields to a small display-width
// scale". Widths/values themselves are owned by the stylesheet, not here.
export type SizeTier = "s" | "m" | "l";

// Char-count boundaries between tiers (how many characters the value shows). The ch box widths these map to
// live in styles.css, tuned against the rendered forms.
function tierForChars(n: number): SizeTier {
    if (n <= 6) return "s";
    if (n <= 12) return "m";
    return "l";
}

export function valueTier(row: Row): SizeTier {
    const kind = controlKind(row);
    // Dropdowns always carry arrow + padding chrome, so the S box is too tight for their label - floor at M.
    // Size by the LONGEST option label (not the current value) so changing the selection never clips.
    if (kind === "enum") {
        const longest = enumOptionList(row).reduce((m, o) => Math.max(m, o.label.length), 0);
        return longest <= 12 ? "m" : "l";
    }
    if (row.numericFormat === "hex32") return "m"; // "0x" + 8 hex digits = 10 chars
    if (kind === "string") return tierForChars(row.size ?? 8); // char[N] field: N chars max
    // Decimal: realistic display width in these formats is <= 7 digits (stats, ids, strrefs, counts, Kit).
    // A number input scrolls if a value is ever wider; a field that routinely shows a large number would
    // get an explicit wider tier (none needed today).
    return "s";
}
