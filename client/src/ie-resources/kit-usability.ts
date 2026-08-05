/**
 * Which kits an ITM kit-usability BIT covers, according to the open install.
 *
 * KITLIST.2DA's `UNUSABLE` column holds each kit's mask in the 32-bit space the four ITM kit-usability bytes
 * form (IESDP kitlist.htm), and its `MIXED` column holds the strref of the kit's display name. So the install
 * answers "which kits does this checkbox exclude" - which the vendored flag table cannot, because the mapping is
 * per-install.
 *
 * The relation is MANY-TO-ONE and that is the point of resolving it at all. Stock BG2 fills all 32 bits with 31
 * kits plus a documented "no kit" bit, so the Enhanced Editions' extra kits reuse masks: on BG:EE eight kits
 * share `0x00004000`, and Blackguard's mask is two bits rather than one. A bit therefore does not name a kit,
 * and picking one would invent an arbitrary winner - so this returns every kit a bit covers and leaves the
 * naming decision to the caller.
 */

import type { TwoDaTable } from "@bgforge/binary";

/** Which quarter of the 32-bit kit mask a kit-usability byte holds; byte 1 is the high one. */
export type KitUsabilityByte = 1 | 2 | 3 | 4;

/**
 * The 32-bit mask a single-bit checkbox in `byte` corresponds to.
 *
 * Multiplication rather than `bit << shift`: a left shift is a SIGNED 32-bit operation, so byte 1's top bit
 * comes out negative (`0x80 << 24` is -2147483648) and never matches the positive `0x80000000` the table
 * parses - which would leave Wild Mage unresolvable while every other bit worked.
 */
export function kitMaskFor(byte: KitUsabilityByte, bit: number): number {
    return bit * 2 ** ((4 - byte) * 8);
}

/**
 * Kit display names per 32-bit usability mask, in table order.
 *
 * Names are de-duplicated per mask: an install can carry two rows for one kit (BG:EE has both `LATHANDER` and
 * `FAKIE` displaying "Priest of Lathander"), which is a duplicate row rather than two kits sharing a bit.
 * A row falls back to its identifier when its `MIXED` strref does not resolve, so a mod kit with no string
 * still names itself.
 */
export function kitsByUsabilityMask(
    table: TwoDaTable,
    strref: (id: number) => string | undefined,
): Map<number, string[]> {
    const unusable = table.columns.indexOf("UNUSABLE");
    const mixed = table.columns.indexOf("MIXED");
    const byMask = new Map<number, string[]>();
    if (unusable === -1) return byMask;
    for (const row of table.rows) {
        // A 2DA writes an absent cell as the table's default marker; only a real hex mask names anything.
        const mask = Number.parseInt(row.cells[unusable] ?? "", 16);
        if (!Number.isFinite(mask) || mask === 0) continue;
        const strrefId = mixed === -1 ? Number.NaN : Number(row.cells[mixed]);
        const name = (Number.isFinite(strrefId) ? strref(strrefId) : undefined) ?? row.cells[0] ?? row.name;
        const names = byMask.get(mask) ?? [];
        if (!names.includes(name)) names.push(name);
        byMask.set(mask, names);
    }
    return byMask;
}

/**
 * The kits each bit of one kit-usability byte covers, keyed by the bit as a decimal string so it matches the
 * mask keys a flag row already uses. Bits no kit claims are absent rather than empty - the caller reads
 * presence as "the install has something to say about this bit".
 *
 * A bit is matched only against masks that are exactly that bit. A multi-bit mask (BG:EE's Blackguard, whose
 * `0x21` is Berserker's bit plus Undead Hunter's) names no single checkbox, so it is deliberately not reported
 * under either: the item is excluded by BOTH bits together, and listing it under one would read as that bit
 * alone excluding it.
 */
export function kitNamesByBit(
    byMask: ReadonlyMap<number, readonly string[]>,
    byte: KitUsabilityByte,
): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (let bit = 1; bit <= 0x80; bit <<= 1) {
        const names = byMask.get(kitMaskFor(byte, bit));
        if (names !== undefined && names.length > 0) out[String(bit)] = [...names];
    }
    return out;
}
