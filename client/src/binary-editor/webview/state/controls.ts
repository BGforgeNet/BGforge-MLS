import type { Row } from "@bgforge/binary-editor";
// Import the pure label helpers from `shared/` directly, NOT through the @bgforge/binary-editor barrel: the
// barrel re-exports the core (openSession etc.), which transitively pulls Node built-ins (fs/path) and breaks
// the browser webview bundle. The webview must only ever import the package's TYPES, never its runtime.
import { enumValueLabel, enumSelectedLabel, enumHexDigits } from "../../../../../shared/enum-label";

export type ControlKind = "number" | "string" | "enum" | "flags" | "resource";

export function controlKind(row: Row): ControlKind {
    if (row.valueType === "enum" && row.enumOptions) return "enum";
    if (row.valueType === "flags" && row.flagOptions) return "flags";
    // A resref field with a game behind it: the install's resources of that type become suggestions, so it
    // renders as a searchable combobox rather than a bare text box. Only with `refExt` - outside a game there
    // is nothing to suggest and the field stays plain text. Never a closed list (see ResourceField).
    if (row.ref?.kind === "resource" && row.refExt !== undefined) return "resource";
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
    // The option maps carry bare names; enumValueLabel (shared with the list-entry summary composer) adds the
    // value prefix here, the single point every enum control renders through - so the synthetic out-of-range
    // option below follows the same form, and no map hand-bakes it. A hex32-typed enum (a packed bitfield like
    // a CRE kit/alignment) prefixes in hex at the field's byte width, so options read "0x00800000 Conjurer" /
    // "0x13 Lawful evil", not the meaningless decimal.
    const hexDigits = enumHexDigits(row.numericFormat, row.size);
    const opts = Object.entries(row.enumOptions ?? {}).map(([k, label]) => {
        const value = Number(k);
        return { value, label: enumValueLabel(value, label, hexDigits) };
    });
    const raw = typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue);
    if (Number.isFinite(raw) && !opts.some((o) => o.value === raw)) {
        // Out of range: enumSelectedLabel falls back to "0 Unknown" (raw is absent from enumOptions here).
        opts.push({ value: raw, label: enumSelectedLabel(raw, row.enumOptions, hexDigits) });
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

// Every enum renders through the searchable Combobox primitive, which relies on these two helpers: all
// dropdowns get substring search and a chevron. An OPEN enum (`enumOpen`, the mod-extensible / advisory
// tables) additionally accepts a custom numeric value via `parseCustomValue`; a closed enum is pick-only.

/** Case-insensitive substring filter over option labels, for the searchable combobox. Empty or
 * whitespace-only query returns all options unchanged. */
export function filterOptions<T extends { label: string }>(options: T[], query: string): T[] {
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

// ---- value-field width tiers (TEXT inputs only) ----
// Classify a TEXT-input value control (number / string / hex) into a SMALL fixed set of display-width tiers
// (S/M/ML/L) keyed to the characters a value RENDERS, not its byte size. The tier maps to a box width in CSS
// (.field-control.tier-{s,m,ml,l} -> --val-ch); the grid track is `auto`, so it sizes to the widest control in
// the column and columns stay aligned. This is the only piece that must live in code: the tier depends on the
// field's char-array length / hex format, which a CSS selector can't read.
//
// Dropdowns do NOT use this scale - they have their own (`dropdownWidth`). A dropdown often shares a column with
// a hex/resref input that needs MORE room than any enum option label, so inheriting the text tier left every
// dropdown over-wide; sizing a dropdown to its own longest option instead is the fix.
export type SizeTier = "s" | "m" | "ml" | "l";

// Char-count boundaries between tiers (how many characters the value shows). The ch box widths these map to
// live in styles.css, tuned against the rendered forms. The ML step exists so a mid-length value (a char[16]
// MAP filename, ~13-20 chars) lands on a fixed middle width instead of jumping the whole way to the wide L box.
function tierForChars(n: number): SizeTier {
    if (n <= 6) return "s";
    if (n <= 12) return "m";
    if (n <= 20) return "ml";
    return "l";
}

export function valueTier(row: Row): SizeTier {
    // Enums are sized by `dropdownWidth`, not here - this scale is for the text inputs (number / string / hex)
    // that set their column's grid track. A hex32 packed id is "0x" + 8 digits = 10 chars.
    if (row.numericFormat === "hex32") return "m";
    // A strref can render "<number> <dialog.tlk line>", so it is sized for text, not for the number's digits.
    // Keyed on the FIELD (`row.ref`), never on whether this particular value resolved: keying on the text
    // sized siblings of one field differently - a resolved sound slot took the L track while the -1 beside it
    // took M, so a 5-column grid came out 266px/266px/117px/117px/117px. Per-value widths read as ragged; the
    // tier is a property of the field. ML, not L: the line is unbounded either way and ellipsizes, so the tier
    // buys a preview rather than the whole string - and ML is what lets the 100 sound slots pack four columns
    // into the panel (`render-cre.mts` pins that). The full line stays in the tooltip.
    if (row.ref?.kind === "strref") return "ml";
    if (controlKind(row) === "string") return tierForChars(row.size ?? 8); // char[N] field: N chars max
    // Decimal width follows the integer's BYTE WIDTH, not the current value (size to the type's max so a value
    // change never clips). The small box shows ~6 chars: an 8/16-bit field (<=6 digits incl. sign) fits, but a
    // 24/32-bit field can show 8-11 digits and overflows it - so it gets the medium box, the same width hex32
    // (also a 32-bit value) already uses. (A real CRE/SPL strref or a MAP script int routinely exceeds 6 chars.)
    return (row.size ?? 0) >= 3 ? "m" : "s";
}

// ---- dropdown widths (enums only) ----
// A dropdown is sized to its OWN longest option, NOT the text-input tier it shares a column with - quantized to
// this small ch scale so dropdowns still align with each other. ch values MUST mirror `.field-control.dd-N` in
// styles.css. Boundaries are the box width in ch; a dropdown picks the smallest box whose text room (box minus
// trigger chrome) fits its widest option, measured in ch so it scales with the theme font like the tiers.
export type DropdownWidth = "dd-1" | "dd-2" | "dd-3" | "dd-4" | "dd-5" | "dd-6";
// The top box exists for the longest real option in the data: a CRE kit renders its packed id beside the
// game's own identifier ("0x00008000 MAGESCHOOL_NECROMANCER"), which needs ~42ch and clipped against the
// former 32ch ceiling. Widening the scale rather than shortening the label, because the identifier is the
// game's and the hex prefix is what makes a packed id legible.
const DROPDOWN_BOX_CH: readonly number[] = [10, 16, 20, 25, 32, 46];
const DROPDOWN_CLASS: readonly DropdownWidth[] = ["dd-1", "dd-2", "dd-3", "dd-4", "dd-5", "dd-6"];
/** Widest box, used wherever a width cannot be computed or no box fits - failing wide never clips. */
const DROPDOWN_WIDEST: DropdownWidth = DROPDOWN_CLASS[DROPDOWN_CLASS.length - 1]!;
// Trigger chrome in ch (padding 0.4rem*2 + gap 0.4rem + arrow ~0.8em + border), subtracted from the box to get
// usable text room. A small breathing margin keeps the longest option off the arrow.
const DROPDOWN_CHROME_CH = 4.5;

// One cached canvas; the font is read fresh per measure so a theme-font change is picked up.
let measureCanvas: HTMLCanvasElement | undefined;
function dropdownMeasure(): { ch: (text: string) => number } | undefined {
    if (typeof document === "undefined") return undefined;
    const canvas = (measureCanvas ??= document.createElement("canvas"));
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined; // no 2d context (e.g. jsdom unit tests) - caller fails wide, never clips
    // Read the editor font from the layout root (where controls inherit it), falling back to body.
    const fontEl = document.querySelector(".layout-root") ?? document.body;
    const cs = getComputedStyle(fontEl);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
    const zero = ctx.measureText("0").width || 1; // 1ch = advance of "0", matching the CSS ch unit
    return { ch: (text: string) => ctx.measureText(text).width / zero };
}

/** Pick a dropdown's width class from its longest option (value-prefixed, as the trigger renders it), measured
 *  in ch. Sized to the option list (not whether it is searchable - every dropdown is), so a long list like the
 *  IE opcodes lands on the widest box from its labels alone. Both fallbacks - no text metrics, and no box wide
 *  enough - take the widest box; the second is the one that silently clipped while the scale topped out below
 *  the longest real option, so it is a bound to keep an eye on, not a resting place. */
export function dropdownWidth(row: Row): DropdownWidth {
    const m = dropdownMeasure();
    if (!m) return DROPDOWN_WIDEST;
    let maxCh = 0;
    for (const o of enumOptionList(row)) maxCh = Math.max(maxCh, m.ch(o.label));
    return dropdownBox(maxCh);
}

/** The smallest box whose text room fits `contentCh`; the widest box when none does (failing wide never clips). */
function dropdownBox(contentCh: number): DropdownWidth {
    const idx = DROPDOWN_BOX_CH.findIndex((box) => box >= contentCh + DROPDOWN_CHROME_CH);
    return idx === -1 ? DROPDOWN_WIDEST : DROPDOWN_CLASS[idx]!;
}

/**
 * A resref picker's width. Sized from the FIELD's char capacity, not its option labels: every option is a
 * resref of the same char array, so the field's own width already bounds them - and it holds even before the
 * list has loaded, which sizing off the options would not.
 */
function resourceWidth(row: Row): DropdownWidth {
    return dropdownBox(row.size ?? 8);
}

// ---- the single width-class classifier every renderer applies ----
/**
 * The display-width CSS class for a field's value control: dropdowns use the `dd-{1..5}` scale (sized to
 * their own longest option), text inputs the `tier-{s,m,ml,l}` scale, and flag grids (full-width) get none.
 *
 * This is the ONE place that maps a row to its width class, applied by BOTH the field layout (Field.svelte)
 * and the grid layout (GridBlock.svelte). A control rendered through a path that skips it carries no width
 * class and clips its value (the bug the harness clip sweep guards against) - so any block that renders a
 * `CellControl` must wrap it in `field-control {controlWidthClass(row)}`.
 */
export function controlWidthClass(row: Row): string {
    const kind = controlKind(row);
    if (kind === "flags") return "";
    if (kind === "enum") return dropdownWidth(row);
    if (kind === "resource") return resourceWidth(row);
    return `tier-${valueTier(row)}`;
}

// ---- numeric range advisory (tooltip text) ----
/** Advisory range hint text for a numeric field's tooltip (e.g. "0 to 255"), from the effective bounds
 *  the host already resolved into `row.min`/`row.max` (storage-type range narrowed by any `domain:`
 *  declaration - see `binary/src/binary-format-contract.ts`). Undefined when the row carries no resolved
 *  range: an enum/flags-presented field (native or overlay-retyped) or a non-numeric field. */
export function rangeTooltip(row: Row): string | undefined {
    if (row.min === undefined || row.max === undefined) return undefined;
    return `${row.min} to ${row.max}`;
}
