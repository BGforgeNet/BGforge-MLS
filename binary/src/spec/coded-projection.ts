/**
 * Int ↔ named-projection helpers for coded scalar fields (flag words, enums,
 * composite refs). Bridges the wire-shape (raw integer) and canonical-doc
 * shape (sorted-array of slug names / named string / tagged object) for any
 * spec entry that carries a `flags` or `enum` table.
 *
 * Used by canonical-reader (int → projection on inbound) and canonical-writer
 * (projection → int before passing to the wire codec). The wire codec itself
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
 *   "Flat"          → "flat"
 *   "NoBlock"       → "noBlock"
 *   "MultiHex"      → "multiHex"
 *   "Magic Hands"   → "magicHands"
 *   "Trans-Energy"  → "transEnergy"
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
 *   (label ↔ slug) is the simplest split for a single-vocabulary toolchain.
 */
export function slugifyCodedName(displayName: string): string {
    const normalized = displayName
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[^A-Za-z0-9]+/g, " ")
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
    return camel;
}

export interface FlagBitEntry {
    readonly key: string;
    readonly mask: number;
    readonly displayName: string;
}

/**
 * Compile a flag table (`{[mask]: displayName}`) into a sorted entry list with
 * canonical keys, plus the OR'd `namedMask` covering every named bit.
 *
 * Sorted alphabetically by canonical key so the projected `flags` array
 * serialises in stable order — toggling one bit adds or removes one entry
 * at its alphabetical position, regardless of bit position.
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
 * Build a default array projection — empty `flags`, no `flagsRaw`. Used by
 * structural-edit transitions and as a default in test fixtures or
 * construction APIs.
 */
export function emptyFlagArray(_table: Readonly<Record<number, string>>): FlagArray {
    return { flags: [] };
}

/**
 * Sorted-array projection of a flag word — `flags` lists every set bit by its
 * canonical (slugified-camelCase) name, `flagsRaw` carries any wire bits the
 * spec table doesn't name as a hex string. Both fields are wire-shape:
 * `flags` order is alphabetical for stable diffs, `flagsRaw` is omitted in
 * the common case where every set bit has a name.
 */
export interface FlagArray {
    flags: string[];
    flagsRaw?: string;
}

/**
 * Project an integer flag word to a sorted array of slugified names. Each
 * named bit that's set contributes its canonical key; unnamed bits land in
 * `flagsRaw` as a lowercase hex string. `flagsRaw` is omitted when all set
 * bits are named.
 *
 * `codecBitWidth` (8 / 16 / 24 / 32) masks `flagsRaw` to the wire width so
 * sign-extended bits a JS bit-OR might surface don't leak in.
 */
export function intToFlagArray(
    table: Readonly<Record<number, string>>,
    value: number,
    codecBitWidth: number,
): FlagArray {
    const { entries, namedMask } = compileFlagTable(table);
    const flags: string[] = [];
    for (const entry of entries) {
        if ((value & entry.mask) !== 0) flags.push(entry.key);
    }
    const codecMask = codecBitWidth >= 32 ? 0xffffffff : (1 << codecBitWidth) - 1;
    const reservoir = (value & ~namedMask & codecMask) >>> 0;
    if (reservoir !== 0) {
        return { flags, flagsRaw: `0x${reservoir.toString(16)}` };
    }
    return { flags };
}

/**
 * Pack a flag array back to an integer. Every name in `flags` contributes its
 * mask; `flagsRaw` (hex) ORs in. Throws on unknown names, duplicate names,
 * malformed `flagsRaw`, or a `flagsRaw` value overlapping a named bit
 * (strict-disjoint invariant — the hand-edit surface should not let the same
 * bit be specified twice).
 */
export function flagArrayToInt(table: Readonly<Record<number, string>>, projection: FlagArray): number {
    const { entries, namedMask } = compileFlagTable(table);
    const byKey = new Map(entries.map((entry) => [entry.key, entry.mask]));
    const seen = new Set<string>();
    let value = 0;
    for (const name of projection.flags) {
        if (seen.has(name)) {
            throw new Error(`flagArrayToInt: duplicate flag name "${name}"`);
        }
        seen.add(name);
        const mask = byKey.get(name);
        if (mask === undefined) {
            throw new Error(`flagArrayToInt: unknown flag "${name}" (known: ${entries.map((e) => e.key).join(", ")})`);
        }
        value = (value | mask) >>> 0;
    }
    if (projection.flagsRaw !== undefined) {
        if (typeof projection.flagsRaw !== "string" || !/^0x[0-9a-f]+$/i.test(projection.flagsRaw)) {
            throw new TypeError(
                `flagArrayToInt: flagsRaw must be a hex string ("0x..."); got ${String(projection.flagsRaw)}`,
            );
        }
        const reservoir = Number.parseInt(projection.flagsRaw, 16);
        if ((reservoir & namedMask) !== 0) {
            const overlapHex = (reservoir & namedMask).toString(16);
            throw new Error(
                `flagArrayToInt: flagsRaw ${projection.flagsRaw} overlaps named-bit mask 0x${overlapHex}; named bits must be set via the flags array`,
            );
        }
        value = (value | reservoir) >>> 0;
    }
    return value;
}
