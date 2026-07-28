/**
 * 2DA row-name tables: the game's own mapping from a row's position to its name.
 *
 * Read from the installed game rather than vendored, for the same reason as IDS - the tables are per-install and
 * mod-extensible. A field backed by one of these (an EFF magic school, a secondary type) stores the row's INDEX,
 * and the row NAME is the identifier; the columns hold other data (a strref, sounds) that no field maps to.
 */

import { decodeTextResource } from "./text-resource";

/**
 * The 2DA header: a `2DA V1.0` signature, a default value for absent cells, then the column names (IESDP
 * 2da.htm). None of the three is a row, and miscounting them shifts every index - silently renaming every
 * value rather than failing.
 */
const HEADER_LINES = 3;

/**
 * Parse a 2DA resource into row index -> row name. A blank line takes no index (it would shift every row after
 * it); malformed rows are skipped rather than failing the whole table.
 */
export function parse2daRowNames(bytes: Uint8Array): Map<number, string> {
    const rows = new Map<number, string>();
    let index = 0;
    for (const line of decodeTextResource(bytes).split(/\r?\n/).slice(HEADER_LINES)) {
        // Real files align columns with a mix of tabs and runs of spaces; the row name is the first token.
        const name = line.trim().split(/\s+/)[0];
        if (name === undefined || name === "") continue;
        rows.set(index, name);
        index++;
    }
    return rows;
}
