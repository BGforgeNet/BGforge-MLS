/**
 * IDS lookup tables: the game's own mapping from a numeric identifier to a symbolic name.
 *
 * Read from the installed game rather than vendored, because the mapping is per-install: BG1's SOUNDOFF.IDS and
 * BG2's SNDSLOT.IDS disagree on most sound slots, and mods extend these tables.
 */

import { decodeTextResource } from "./text-resource";

/**
 * Every row of an IDS resource, keyed by value, in file order.
 *
 * Real tables name one value more than once - BG2:ToB's ACTION.IDS does it 32 times, where id 8 is both
 * `Dialogue` and `Dialog` and id 160 is `ApplySpell(O:Target,I:Spell*Spell)` beside
 * `ApplySpellRES(S:RES*,O:Target)`. Those two are not spellings of one thing: they take different argument
 * types, and only the stored record says which was meant, so a caller that has the record picks. `parseIds`
 * keeps one row per value and cannot serve that.
 */
export function parseIdsAll(bytes: Uint8Array): Map<number, string[]> {
    const table = new Map<number, string[]>();
    for (const [value, name] of idsRows(bytes)) {
        const rows = table.get(value);
        if (rows === undefined) table.set(value, [name]);
        else rows.push(name);
    }
    return table;
}

/**
 * Parse an IDS resource into value -> identifier. Malformed rows are skipped rather than failing the table.
 *
 * Where a value is named twice the LAST row wins, and that is deliberate rather than incidental. Switching to
 * the first row was considered and rejected: it changes the name of 8 values across the tables the specs
 * declare - CLASS 202 reads `LONG_BOW` for an item and `MAGE_ALL` for a creature, KIT 16384 `TRUECLASS` or
 * `MAGESCHOOL_GENERALIST` - and nothing in the format ranks the rows, so neither order is more correct than the
 * other and flipping it would silently relabel shipped fields. A caller that must choose between rows that
 * genuinely differ reads `parseIdsAll` and decides from the record it holds.
 */
export function parseIds(bytes: Uint8Array): Map<number, string> {
    return new Map(idsRows(bytes));
}

function* idsRows(bytes: Uint8Array): Generator<[number, string]> {
    const text = decodeTextResource(bytes);
    for (const line of text.split(/\r?\n/)) {
        // Two columns, value then identifier (IESDP ids.htm), the identifier running to end of line: MISSILE.IDS
        // names projectiles in prose ("3 Arrow Exploding") and TRIGGER.IDS writes signatures whose parameter
        // names carry spaces, so a first-token-only read drops those rows instead of shortening them. The header
        // lines - a file identifier such as "IDS V1.0" and an entry count - still fail this shape, the first on
        // its non-numeric value and the second on having no second column.
        const match = /^\s*(\S+)\s+(\S.*?)\s*$/.exec(line);
        const name = match?.[2];
        if (match === null || name === undefined) continue;
        const value = Number(match[1]);
        if (!Number.isInteger(value)) continue;
        yield [value, name];
    }
}
