/**
 * IDS lookup tables: the game's own mapping from a numeric identifier to a symbolic name.
 *
 * Read from the installed game rather than vendored, because the mapping is per-install: BG1's SOUNDOFF.IDS and
 * BG2's SNDSLOT.IDS disagree on most sound slots, and mods extend these tables.
 */

import { decodeTextResource } from "./text-resource";

/** Parse an IDS resource into value -> identifier. Malformed rows are skipped rather than failing the table. */
export function parseIds(bytes: Uint8Array): Map<number, string> {
    const text = decodeTextResource(bytes);
    const table = new Map<number, string>();
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
        table.set(value, name);
    }
    return table;
}
