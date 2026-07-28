/**
 * Fills in the parts of a row only the host can supply, because only the host holds the open game: the
 * `dialog.tlk` line behind a strref, and the name an IDS table gives a slot.
 *
 * Rows reach the webview through several message shapes (`init`, `children`, `changeSet`, the spellbook and
 * effect-tree views), and more may follow - so this walks the message generically instead of being applied at
 * each post site, which is the shape that goes stale the moment a seventh message carries rows.
 *
 * Structurally sharing: a subtree with no strref row is returned as-is, so a record that is not from a game -
 * where the resolver answers undefined for everything - allocates nothing.
 */

/** Row shapes this fills in. Matched structurally: this module never imports the editor's Row type, so it
 *  walks messages whose row-bearing shape it does not need to know. */
interface StrrefRow {
    strref: true;
    rawValue: number;
}

interface IdsSlotRow {
    idsSlot: { tables: readonly string[]; index: number };
    name: string;
}

/** What the host can answer about the open game. Undefined from either means "no game, or nothing there". */
export interface GameLookups {
    strref(strref: number): string | undefined;
    slotLabel(tables: readonly string[], index: number): string | undefined;
}

function isIdsSlotRow(value: object): value is IdsSlotRow {
    if (!("idsSlot" in value) || !("name" in value) || typeof value.name !== "string") return false;
    const slot: unknown = value.idsSlot;
    return (
        typeof slot === "object" &&
        slot !== null &&
        "tables" in slot &&
        Array.isArray(slot.tables) &&
        "index" in slot &&
        typeof slot.index === "number"
    );
}

function isStrrefRow(value: object): value is StrrefRow {
    return (
        "strref" in value &&
        value.strref === true &&
        "rawValue" in value &&
        typeof value.rawValue === "number" &&
        !("strrefText" in value)
    );
}

export function withGameContext<T>(value: T, lookups: GameLookups): T {
    if (Array.isArray(value)) {
        let changed = false;
        const next = value.map((entry) => {
            const resolved = withGameContext(entry, lookups);
            if (resolved !== entry) changed = true;
            return resolved;
        });
        return (changed ? next : value) as T;
    }
    if (typeof value !== "object" || value === null) return value;

    // Both, not either: a CRE sound slot is a strref (the line it points at) AND an IDS-named slot (its label),
    // so these are applied in sequence rather than as exclusive branches.
    let row = value;
    if (isStrrefRow(row)) {
        const text = lookups.strref(row.rawValue);
        if (text !== undefined) row = { ...row, strrefText: text };
    }
    if (isIdsSlotRow(row)) {
        const identifier = lookups.slotLabel(row.idsSlot.tables, row.idsSlot.index);
        // The slot's own number is kept rather than the IDS value so the label reads consistently against the
        // unresolved slots beside it (the tail of a sound-set block has no IDS entry); they differ by one.
        if (identifier !== undefined) row = { ...row, name: `${row.idsSlot.index + 1} ${identifier}` };
    }
    if (row !== value) return row as T;

    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        const resolved = withGameContext(entry, lookups);
        if (resolved !== entry) changed = true;
        next[key] = resolved;
    }
    return (changed ? next : value) as T;
}
