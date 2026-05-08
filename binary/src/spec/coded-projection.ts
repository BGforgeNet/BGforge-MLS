/**
 * Int <-> named-projection helpers for coded scalar fields (flag words, enums,
 * composite refs). Bridges the wire-shape (raw integer) and canonical-doc
 * shape (sorted-array of slug names / named string / tagged object) for any
 * spec entry that carries a `flags` or `enum` table.
 *
 * Used by canonical-reader (int -> projection on inbound) and canonical-writer
 * (projection -> int before passing to the wire codec). The wire codec itself
 * stays int-shaped so the byte layout primitives in `derive-typed-binary.ts`
 * need no change.
 */

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Convert a flag/enum table's display name into a canonical JSON / TypeScript
 * key. Lowercases the first character of each word, strips non-alphanumerics,
 * joins as camelCase. Mirrors `snapshot-common.ts:slugify` but enforces a
 * strict identifier-shape result; throws on tables whose display strings
 * cannot be safely slugified (e.g. starts with a digit), so spec authors fix
 * the table at declaration rather than producing invalid JSON keys at
 * runtime.
 *
 * Examples:
 *   "Flat"          -> "flat"
 *   "NoBlock"       -> "noBlock"
 *   "MultiHex"      -> "multiHex"
 *   "Magic Hands"   -> "magicHands"
 *   "Trans-Energy"  -> "transEnergy"
 *
 * Why slugified identifiers rather than the display strings themselves:
 * - The construction API surfaces flags as TS members (e.g.
 *   `item.header.flags` typed as a literal-name union); identifier-shaped
 *   names get the canonical dot-trigger autocomplete with per-flag JSDoc
 *   visible inline, which a quoted-display-string union does not.
 * - JSON Schema `items.enum` autocomplete in editors works for both shapes,
 *   but identifier tokens are faster to type and avoid case/spacing
 *   ambiguities ("No LOS required" vs "No los required" vs "No LOS Required"
 *   when a modder is guessing from the engine docs).
 * - Schema validation messages quote the canonical key, so a typo error
 *   reads `"loghtThru" not in [..., lightThru, ...]` rather than the same
 *   error decorated with spaces and punctuation.
 * - The display string remains the parsed-tree label and the engine-doc
 *   parlance; the slug is the toolchain token. One translation point
 *   (label <-> slug) is the simplest split for a single-vocabulary toolchain.
 */
export function slugifyCodedName(displayName: string): string {
    const normalized = displayName
        .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replaceAll(/[^A-Za-z0-9]+/g, " ")
        .trim();

    if (!normalized) {
        throw new Error(`slugifyCodedName: name "${displayName}" produces an empty key`);
    }

    const parts = normalized.split(/\s+/);
    const camel = parts
        .map((part, index) => {
            if (index === 0) {
                return part[0]!.toLowerCase() + part.slice(1);
            }
            return part[0]!.toUpperCase() + part.slice(1);
        })
        .join("");

    if (!IDENTIFIER_PATTERN.test(camel)) {
        throw new Error(
            `slugifyCodedName: name "${displayName}" produced "${camel}" which is not a valid JS identifier`,
        );
    }
    if (RESERVED_BIT_PATTERN.test(camel)) {
        // `bit<N>` is the reserved sentinel for unnamed set bits in
        // FlagArray projections (see `intToFlagArray`). Spec authors must
        // not pick a display name whose slug collides with that namespace,
        // since the projection cannot distinguish a spec-named `bit13`
        // from "bit at position 13" on encode.
        throw new Error(
            `slugifyCodedName: name "${displayName}" produced reserved sentinel "${camel}"; flag display names must not slugify to bit<N>`,
        );
    }
    return camel;
}

const RESERVED_BIT_PATTERN = /^bit\d+$/;

export interface FlagBitEntry {
    readonly key: string;
    readonly mask: number;
    readonly displayName: string;
}

/**
 * Compile a flag table (`{[mask]: displayName}`) into a sorted entry list with
 * canonical keys, plus the OR'd `namedMask` covering every named bit.
 *
 * Sorted alphabetically by canonical key so the projected array serialises
 * in stable order - toggling a named bit adds or removes one entry at its
 * alphabetical position, regardless of bit position.
 *
 * Returns frozen entries to discourage in-place mutation.
 */
export function compileFlagTable(table: Readonly<Record<number, string>>): {
    entries: readonly FlagBitEntry[];
    namedMask: number;
} {
    const entries: FlagBitEntry[] = [];
    let namedMask = 0;
    for (const [maskStr, displayName] of Object.entries(table)) {
        const mask = Number(maskStr);
        if (!Number.isFinite(mask) || mask < 0 || !Number.isInteger(mask)) {
            throw new Error(`compileFlagTable: non-integer mask "${maskStr}"`);
        }
        const key = slugifyCodedName(displayName);
        entries.push({ key, mask, displayName });
        namedMask = (namedMask | mask) >>> 0;
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return { entries: Object.freeze(entries), namedMask };
}

/**
 * Sorted-array projection of a flag word. Each entry is one of:
 *
 * - A canonical (slugified-camelCase) key from the spec table, identifying
 *   a named set bit (e.g. `lightThru`).
 * - `bit<N>` where N is the zero-based bit position, identifying a set bit
 *   the spec table doesn't name (e.g. `bit5`, `bit13`).
 *
 * Canonical sort order: named keys alphabetically first, then `bit<N>`
 * entries in ascending bit-position order. Toggling one bit adds or removes
 * exactly one entry at its sorted position - same shape for named and
 * unnamed bits, so diffs read uniformly.
 *
 * Strict-disjoint invariant: a `bit<N>` entry is rejected at the wire
 * boundary if `1 << N` falls inside the spec table's named-mask, since a
 * hand-edit must use the canonical name for any spec-named bit. Encode
 * also rejects N >= codecBitWidth (no synthetic bits past the wire word).
 */
export type FlagArray = string[];

/**
 * Build a default flag-array projection (empty array). Used by
 * structural-edit transitions and as a default in test fixtures or
 * construction APIs.
 */
export function emptyFlagArray(_table: Readonly<Record<number, string>>): FlagArray {
    return [];
}

/**
 * Project an integer flag word to a sorted FlagArray. Named set bits
 * contribute their canonical key (alphabetical); unnamed set bits within
 * the codec's bit width contribute `bit<N>` entries (numeric).
 *
 * `codecBitWidth` (8 / 16 / 24 / 32) bounds the per-bit scan so sign-
 * extended bits a JS bit-OR might surface don't leak in.
 */
export function intToFlagArray(
    table: Readonly<Record<number, string>>,
    value: number,
    codecBitWidth: number,
): FlagArray {
    const { entries, namedMask } = compileFlagTable(table);
    const named: string[] = [];
    for (const entry of entries) {
        if ((value & entry.mask) !== 0) named.push(entry.key);
    }
    const codecMask = codecBitWidth >= 32 ? 0xffffffff : (1 << codecBitWidth) - 1;
    const reservoir = (value & ~namedMask & codecMask) >>> 0;
    const bits: string[] = [];
    for (let i = 0; i < codecBitWidth; i++) {
        if ((reservoir & (1 << i)) !== 0) bits.push(`bit${i}`);
    }
    return [...named, ...bits];
}

/**
 * Pack a FlagArray back to an integer. Each entry contributes its bit(s):
 * named keys via the spec table, `bit<N>` via `1 << N`. Throws on:
 *
 * - unknown names that match neither the table nor `bit<N>`,
 * - duplicate entries,
 * - `bit<N>` whose position overlaps a named-bit mask (strict-disjoint
 *   invariant - the hand-edit surface should not let the same bit be
 *   specified twice),
 * - `bit<N>` with N >= codecBitWidth (no synthetic bits past the wire
 *   word).
 */
export function flagArrayToInt(
    table: Readonly<Record<number, string>>,
    projection: FlagArray,
    codecBitWidth: number,
): number {
    const { entries, namedMask } = compileFlagTable(table);
    const byKey = new Map(entries.map((entry) => [entry.key, entry.mask]));
    const seen = new Set<string>();
    let value = 0;
    for (const name of projection) {
        if (seen.has(name)) {
            throw new Error(`flagArrayToInt: duplicate flag name "${name}"`);
        }
        seen.add(name);
        const mask = byKey.get(name);
        if (mask !== undefined) {
            value = (value | mask) >>> 0;
            continue;
        }
        const bitMatch = RESERVED_BIT_PATTERN.exec(name);
        if (!bitMatch) {
            throw new Error(`flagArrayToInt: unknown flag "${name}" (known: ${entries.map((e) => e.key).join(", ")})`);
        }
        const position = Number(bitMatch[0].slice(3));
        if (position >= codecBitWidth) {
            throw new Error(
                `flagArrayToInt: bit position ${position} exceeds codec width ${codecBitWidth} for "${name}"`,
            );
        }
        const bitMask = (1 << position) >>> 0;
        if ((bitMask & namedMask) !== 0) {
            throw new Error(
                `flagArrayToInt: bit position ${position} overlaps named-bit mask; named bits must be set by their canonical name, not "${name}"`,
            );
        }
        value = (value | bitMask) >>> 0;
    }
    return value;
}
