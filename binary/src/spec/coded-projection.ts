/**
 * Int ↔ named-projection helpers for coded scalar fields (flag words, enums,
 * composite refs). Bridges the wire-shape (raw integer) and canonical-doc
 * shape (named dict / string / tagged object) for any spec entry that carries
 * a `flags` or `enum` table.
 *
 * Used by canonical-reader (int → dict on inbound) and canonical-writer
 * (dict → int before passing to the wire codec). The wire codec itself stays
 * int-shaped so the byte layout primitives in `derive-typed-binary.ts` need no
 * change.
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
 * Sorted alphabetically by canonical key so the dict serialises in stable
 * order — toggling one bit changes one line, regardless of bit position.
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

export type FlagDict = Readonly<Record<string, boolean | string>>;

/**
 * Build an all-cleared flag dict for the given table — every named bit set
 * to `false`, no `_bits` reservoir. Used by structural-edit transitions
 * (e.g. "I'm changing object type to Item; new sections start with all
 * flags off") and as a default in test fixtures / construction APIs.
 */
export function emptyFlagDict(table: Readonly<Record<number, string>>): FlagDict {
    const { entries } = compileFlagTable(table);
    const out: Record<string, boolean | string> = {};
    for (const entry of entries) {
        out[entry.key] = false;
    }
    return out;
}

/**
 * Project an integer flag word to a named dict. Each named bit becomes a
 * boolean keyed by its canonical name; remaining bits land in `_bits` as a
 * lowercase hex string (`"0x..."`). The dict carries every named key (true or
 * false), and `_bits` is omitted when all unnamed bits are zero.
 *
 * `codecBitWidth` is the wire codec's bit width (8 / 16 / 24 / 32) — masks
 * `_bits` to that width to drop sign-extended bits a JS bit-OR might surface.
 */
export function intToFlagDict(table: Readonly<Record<number, string>>, value: number, codecBitWidth: number): FlagDict {
    const { entries, namedMask } = compileFlagTable(table);
    const out: Record<string, boolean | string> = {};
    for (const entry of entries) {
        out[entry.key] = (value & entry.mask) !== 0;
    }
    const codecMask = codecBitWidth >= 32 ? 0xffff_ffff : (1 << codecBitWidth) - 1;
    const reservoir = (value & ~namedMask & codecMask) >>> 0;
    if (reservoir !== 0) {
        out._bits = `0x${reservoir.toString(16)}`;
    }
    return out;
}

export type EnumValue = string | number;

/**
 * Project an integer enum value to its named-string form when the value is
 * in the table, otherwise pass through as a raw number. The canonical-doc
 * shape carries `EnumValue = string | number`: the named form is the
 * diff-friendly default, the int form is the reservoir for unknown values.
 *
 * For closed enums (`enumOpen` not set on the spec), the strict zod schema
 * rejects unknown ints — but the projection itself is permissive so a
 * malformed file still loads through `loadCanonicalProJsonSnapshotPermissive`
 * and surfaces in the editor.
 */
export function intToEnumValue(table: Readonly<Record<number, string>>, value: number): EnumValue {
    const name = table[value];
    return name !== undefined ? name : value;
}

/**
 * Reverse of `intToEnumValue`. Looks up the int by display-name match against
 * the enum table; falls through to a numeric value as-is. Throws for a
 * string that doesn't match any table entry — that's a hand-edit error, not
 * a graceful fallback.
 */
export function enumValueToInt(table: Readonly<Record<number, string>>, value: EnumValue): number {
    if (typeof value === "number") return value;
    for (const [intStr, name] of Object.entries(table)) {
        if (name === value) return Number(intStr);
    }
    throw new Error(
        `enumValueToInt: name "${value}" not found in enum table (known: ${Object.values(table).join(", ")})`,
    );
}

/**
 * Pack a flag dict back to an integer. Every named bit set true contributes
 * its mask; `_bits` (hex) ORs in. Throws if a named bit is also present in
 * `_bits` (strict-disjoint invariant — the hand-edit surface should not let
 * the same bit be specified twice).
 */
export function flagDictToInt(table: Readonly<Record<number, string>>, dict: FlagDict): number {
    const { entries, namedMask } = compileFlagTable(table);
    let value = 0;
    for (const entry of entries) {
        const bit = dict[entry.key];
        if (bit === true) value = (value | entry.mask) >>> 0;
        else if (bit !== false && bit !== undefined) {
            throw new TypeError(
                `flagDictToInt: flag "${entry.key}" expected boolean, got ${typeof bit} (${String(bit)})`,
            );
        }
    }
    const reservoirRaw = dict._bits;
    if (reservoirRaw !== undefined) {
        if (typeof reservoirRaw !== "string" || !/^0x[0-9a-f]+$/i.test(reservoirRaw)) {
            throw new TypeError(`flagDictToInt: _bits must be a hex string ("0x..."); got ${String(reservoirRaw)}`);
        }
        const reservoir = Number.parseInt(reservoirRaw, 16);
        if ((reservoir & namedMask) !== 0) {
            const overlapHex = (reservoir & namedMask).toString(16);
            throw new Error(
                `flagDictToInt: _bits ${reservoirRaw} overlaps named-bit mask 0x${overlapHex}; named bits must be set via their boolean key`,
            );
        }
        value = (value | reservoir) >>> 0;
    }
    return value;
}
