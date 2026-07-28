/**
 * Fills in the parts of a row only the host can supply, because only the host holds the open game: the
 * `dialog.tlk` line behind a strref, and the name an IDS table gives a slot.
 *
 * Rows reach the webview through several message shapes (`init`, `children`, `changeSet`, the spellbook and
 * effect-tree views), and more may follow - so this walks the message generically instead of being applied at
 * each post site, which is the shape that goes stale the moment a seventh message carries rows.
 *
 * Structurally sharing: a subtree with no resolvable row is returned as-is, so a record that is not from a game
 * - where the resolver answers undefined for everything - allocates nothing.
 */

/** Row shapes this fills in. Matched structurally: this module never imports the editor's Row type, so it
 *  walks messages whose row-bearing shape it does not need to know. */
interface ValueRefRow {
    ref: { kind: string; tables?: readonly string[]; keyShift?: number };
    rawValue: number;
    enumOptions?: Record<string, string>;
    valueType?: string;
    /** Field width in bytes; bounds which shifted keys the field can actually store. */
    size?: number;
}

interface SlotRefRow {
    slotRef: { ref: { kind: string; tables?: readonly string[] }; index: number };
    name: string;
}

/** What the host can answer about the open game. Undefined from any of these means "no game, or nothing there". */
export interface GameLookups {
    strref(strref: number): string | undefined;
    slotLabel(tables: readonly string[], index: number): string | undefined;
    /**
     * The whole naming table for a field whose value space the game defines. `kind` selects the source - an IDS
     * table keyed by value, or a 2DA keyed by row index - because the merge below is identical either way and
     * only the resource differs.
     */
    namingTable(kind: string, tables: readonly string[]): ReadonlyMap<number, string> | undefined;
}

/** Ref kinds that name a value from a whole table the game ships (as opposed to a per-value lookup like a
 *  strref, which cannot be pushed as a list). */
const NAMING_KINDS = new Set(["ids", "2da"]);

/** A `{ kind: ... }` ref as it survives the structural walk - the union's own type lives in the binary lib. */
function isRef(value: unknown): value is { kind: string } {
    return typeof value === "object" && value !== null && "kind" in value && typeof value.kind === "string";
}

function isSlotRefRow(value: object): value is SlotRefRow {
    if (!("slotRef" in value) || !("name" in value) || typeof value.name !== "string") return false;
    const slot: unknown = value.slotRef;
    return (
        typeof slot === "object" &&
        slot !== null &&
        "ref" in slot &&
        isRef(slot.ref) &&
        "index" in slot &&
        typeof slot.index === "number"
    );
}

function isValueRefRow(value: object): value is ValueRefRow {
    return (
        "ref" in value &&
        isRef(value.ref) &&
        "rawValue" in value &&
        typeof value.rawValue === "number" &&
        !("strrefText" in value)
    );
}

/**
 * The row's option list once the install's own naming table is folded in: the game wins per value, the vendored
 * table fills what it does not cover. Vendored entries are kept rather than replaced wholesale because the two
 * disagree in both directions - BG2's RACE.IDS carries 82 entries against 8 vendored, while its SPECIFIC.IDS
 * carries 3 against 11.
 *
 * A field with no vendored table at all (CRE animationId) arrives as a plain number, so it is also re-typed to
 * an enum here - otherwise the names would resolve into a control that never reads them. Always open: these
 * value spaces are mod-extended, so a value no table names has to stay editable.
 */
function namedByGame(
    row: ValueRefRow,
    table: ReadonlyMap<number, string>,
): { enumOptions: Record<string, string>; valueType: string; enumOpen: true } {
    const merged: Record<string, string> = { ...row.enumOptions };
    // A table may be keyed in a different space than the field stores (a CRE kit holds the KIT.IDS key in its
    // high word), so shift first - then drop anything that no longer fits the field, since an option list must
    // never offer a value the field cannot hold. KIT.IDS's two PC-only kits are already in stored form and
    // overflow a u32 once shifted; they drop out here rather than becoming nonsense entries.
    const shift = row.ref.keyShift ?? 0;
    const limit = row.size === undefined ? Infinity : 2 ** (8 * row.size);
    for (const [key, name] of table) {
        const stored = key * 2 ** shift;
        if (stored < limit) merged[String(stored)] = name;
    }
    return { enumOptions: merged, valueType: "enum", enumOpen: true };
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

    // Both, not either: `ref` resolves a row's VALUE and `slotRef` its LABEL, and a CRE sound slot carries each.
    // Applied in sequence rather than as exclusive branches - returning after the first is how the label used to
    // get dropped on exactly the rows the feature exists for.
    let row = value;
    if (isValueRefRow(row) && row.ref.kind === "strref") {
        const text = lookups.strref(row.rawValue);
        if (text !== undefined) row = { ...row, strrefText: text };
    }
    if (isValueRefRow(row) && NAMING_KINDS.has(row.ref.kind) && row.ref.tables !== undefined) {
        const table = lookups.namingTable(row.ref.kind, row.ref.tables);
        if (table !== undefined) row = { ...row, ...namedByGame(row, table) };
    }
    if (isSlotRefRow(row)) {
        const { ref, index } = row.slotRef;
        const identifier =
            ref.kind === "ids" && ref.tables !== undefined ? lookups.slotLabel(ref.tables, index) : undefined;
        // The slot's own number is kept rather than the IDS value so the label reads consistently against the
        // unresolved slots beside it (the tail of a sound-set block has no IDS entry); they differ by one.
        if (identifier !== undefined) row = { ...row, name: `${index + 1} ${identifier}` };
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
