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
    ref: {
        kind: string;
        tables?: readonly string[];
        keyEncoding?: Readonly<Record<string, string>>;
        symbolResource?: { readonly table: string; readonly type: string };
    };
    rawValue: number;
    enumOptions?: Record<string, string>;
    valueType?: string;
    /** Field width in bytes; bounds which shifted keys the field can actually store. */
    size?: number;
}

interface ResourceRefRow {
    ref: { kind: string; type?: string; byFlavour?: Readonly<Record<string, string>> };
    rawValue: string;
}

interface SlotRefRow {
    slotRef: { ref: { kind: string; tables?: readonly string[] }; index: number };
    name: string;
}

/** One naming table the install ships, tagged with which of the declared candidates it is. Restated here
 *  rather than imported from the host's resolver, as `resourceType`'s declaration below is - this module is
 *  deliberately free of imports so it can walk message shapes it does not own. */
export interface NamedTable {
    readonly table: string;
    readonly entries: ReadonlyMap<number, string>;
}

/** What the host can answer about the open game. Undefined from any of these means "no game, or nothing there". */
export interface GameLookups {
    strref(strref: number): string | undefined;
    slotLabel(tables: readonly string[], index: number): string | undefined;
    /**
     * The naming tables for a field whose value space the game defines - every declared candidate the install
     * ships, in declaration order, each tagged with its own name so the ref's per-table key encoding can be
     * applied. `kind` selects the source - an IDS table keyed by value, or a 2DA keyed by row index - because
     * the merge below is identical either way and only the resource differs.
     */
    namingTable(kind: string, tables: readonly string[]): readonly NamedTable[] | undefined;
    /**
     * What this resref field points at in the open game, or undefined outside one. Takes the whole declaration
     * because a few fields store a different type in one flavour (ITM `replacement` is an item everywhere but
     * PSTEE, which stores a sound), and only the host knows which game this is. `present` answers separately
     * whether the CURRENT value is there - the type holds even for an empty field.
     */
    resourceType(
        decl: { type: string; byFlavour?: Readonly<Record<string, string>> },
        resref: string,
    ): { type: string; present: boolean } | undefined;
    /**
     * The names the install gives a BITFIELD's bits, keyed by the bit as a decimal string. Many names per bit is
     * normal - several Enhanced Edition kits share one ITM kit-usability bit - so the caller must not reduce a
     * list to one. Undefined outside a game or when the install's table says nothing.
     */
    flagBitNames(ref: FlagsBitRef): Readonly<Record<string, readonly string[]>> | undefined;
    /**
     * Whether opening a resource of this type reaches an editor that can show it. The chip promises a view, and
     * `vscode.openWith`'s `"default"` is the plain TEXT editor, so a type no editor of ours reads renders as
     * bytes - a promise broken rather than degraded. Derived host-side from the same routing that picks the
     * view, so registering a reader for a format re-enables its chip with no change here.
     */
    canOpen(ext: string): boolean;
    /**
     * Whether a resource of this type can be drawn as an inline thumbnail. Asked here rather than in the view
     * because the decode is the host's, and the two must agree: the view reserves the slot off this answer, so a
     * type the host cannot draw would leave a permanent gap in the row.
     */
    canThumbnail(ext: string): boolean;
}

/** Ref kinds that name a value from a whole table the game ships (as opposed to a per-value lookup like a
 *  strref, which cannot be pushed as a list). */
const NAMING_KINDS = new Set(["ids", "2da"]);

const WORD = 0x1_0000;

/**
 * Exchange a dword's two halves. Its own inverse, so one function converts key -> stored and back.
 *
 * Arithmetic rather than shifts: `<< 16` yields a SIGNED int32, so any key whose low word has the top bit set
 * comes back negative and keys an option row no value can match.
 */
function swapWords(value: number): number {
    return Math.floor(value / WORD) + (value % WORD) * WORD;
}

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

function isResourceRefRow(value: object): value is ResourceRefRow {
    return "ref" in value && isRef(value.ref) && "rawValue" in value && typeof value.rawValue === "string";
}

/** Matched structurally like the ref rows above - `byte` is the only member this module passes on. */
interface FlagsBitRef {
    kind: string;
    byte: number;
}

type FlagsRefRow = { flagsRef: FlagsBitRef };

function isFlagsRefRow(value: object): value is FlagsRefRow {
    return (
        "flagsRef" in value &&
        typeof value.flagsRef === "object" &&
        value.flagsRef !== null &&
        "kind" in value.flagsRef &&
        !("flagBitNames" in value)
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
 * The value a field stores for a table key, per the encoding the ref declares for THAT table - a table absent
 * from the map is keyed exactly as the field stores it. Per table because one declaration can name a value in
 * two keyings at once: a projectile is MISSILE.IDS's key outright and PROJECTL.IDS's key plus one.
 */
function storedFromKey(key: number, encoding: string | undefined): number {
    switch (encoding) {
        case "swappedWords":
            return swapWords(key);
        case "keyPlusOne":
            return key + 1;
        default:
            return key;
    }
}

/** The inverse: a stored value back to the table key it came from. `swappedWords` is its own inverse. */
function keyFromStored(stored: number, encoding: string | undefined): number {
    switch (encoding) {
        case "swappedWords":
            return swapWords(stored);
        case "keyPlusOne":
            return stored - 1;
        default:
            return stored;
    }
}

/** The row properties a resource that the game HAS earns, by what can be done with its type. */
interface Affordances {
    openTarget?: { resref: string; ext: string };
    thumbnail?: { resref: string; ext: string };
}

/**
 * What a present resource offers: an open chip where an editor can show it, an inline picture where it IS one.
 *
 * One function for both, and shared by the two paths that resolve a target, because they are independent
 * questions asked of the same pair - a type could be drawable without being openable - and deciding them apart
 * is how a resref field and its numeric sibling end up disagreeing about the same resource.
 */
function affordancesFor(resref: string, ext: string, lookups: GameLookups): Affordances {
    const target = { resref, ext };
    return {
        ...(lookups.canOpen(ext) ? { openTarget: target } : {}),
        ...(lookups.canThumbnail(ext) ? { thumbnail: target } : {}),
    };
}

/**
 * The resource a NUMERIC field's current value names, when the ref says one of its tables holds resrefs -
 * PROJECTL.IDS's symbols are `.PRO` basenames, so a projectile value identifies a real file. Near Infinity
 * carries the same pairing on this field.
 *
 * Never `refExt`: the field stores a number chosen from a named list, so it must not become a resref picker.
 * And only when the game HAS the resource, matching the resref rule below - an unresolvable name gets nothing
 * rather than a broken affordance.
 */
function resourceNamedByValue(
    row: ValueRefRow,
    tables: readonly NamedTable[],
    lookups: GameLookups,
): Affordances | undefined {
    const decl = row.ref.symbolResource;
    const source = decl === undefined ? undefined : tables.find((t) => t.table === decl.table);
    if (decl === undefined || source === undefined) return;
    const symbol = source.entries.get(keyFromStored(row.rawValue, row.ref.keyEncoding?.[decl.table]));
    if (symbol === undefined || symbol === "") return;
    const target = lookups.resourceType({ type: decl.type }, symbol);
    if (target?.present !== true) return;
    return affordancesFor(symbol, target.type, lookups);
}

/**
 * The row's option list once the install's own naming tables are folded in: the game wins per value, the
 * vendored table fills what it does not cover. Vendored entries are kept rather than replaced wholesale because
 * the two disagree in both directions - BG2's RACE.IDS carries 82 entries against 8 vendored, while its
 * SPECIFIC.IDS carries 3 against 11.
 *
 * Every candidate the install ships contributes, with the earlier declaration winning a key they both name.
 * A pair's tables each name keys the other cannot - a projectile's authoritative table has no entry for the
 * commonest stored value, which only its co-candidate names - so stopping at the first present drops whatever
 * only the runner-up covers.
 *
 * A field with no vendored table at all (CRE animationId) arrives as a plain number, so it is also re-typed to
 * an enum here - otherwise the names would resolve into a control that never reads them. Always open: these
 * value spaces are mod-extended, so a value no table names has to stay editable.
 */
function namedByGame(
    row: ValueRefRow,
    tables: readonly NamedTable[],
): { enumOptions: Record<string, string>; valueType: string; enumOpen: true } {
    const merged: Record<string, string> = { ...row.enumOptions };
    // A table may be keyed in a different space than the field stores (a CRE kit holds the KIT.IDS key in the
    // other half of its dword), so convert first - then drop anything that does not fit the field, since an
    // option list must never offer a value the field cannot hold. Bounded at BOTH ends: an IDS is plain text a
    // mod can put anything in, and a negative key is as unstorable as an oversized one.
    const limit = row.size === undefined ? Infinity : 2 ** (8 * row.size);
    // Least-preferred candidate first, so an earlier one overwrites it and both overwrite the vendored table.
    for (const { table, entries } of tables.toReversed()) {
        const encoding = row.ref.keyEncoding?.[table];
        for (const [key, name] of entries) {
            const stored = storedFromKey(key, encoding);
            if (stored >= 0 && stored < limit) merged[String(stored)] = name;
        }
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
        // Empty rather than absent: a TLK entry can exist and be blank - common for the unused sound slots a
        // CRE leaves pointing at one - and a blank line is nothing to show, so the field keeps its number
        // instead of rendering a trailing space and an empty tooltip.
        if (text !== undefined && text !== "") row = { ...row, strrefText: text };
    }
    if (isValueRefRow(row) && NAMING_KINDS.has(row.ref.kind) && row.ref.tables !== undefined) {
        const tables = lookups.namingTable(row.ref.kind, row.ref.tables);
        if (tables !== undefined) {
            // Read before the spread: `row` is re-typed to the merged shape below, and the value the resource
            // is derived from is the one this row already holds.
            const offers = resourceNamedByValue(row, tables, lookups);
            row = { ...row, ...namedByGame(row, tables) };
            if (offers !== undefined) row = { ...row, ...offers };
        }
    }
    // A third axis beside `ref` (the row's VALUE) and `slotRef` (its label): what its BITS mean. A bitfield can
    // carry `flagsRef` and nothing else, so this is its own pass rather than a branch of the ref handling.
    if (isFlagsRefRow(row)) {
        const names = lookups.flagBitNames(row.flagsRef);
        if (names !== undefined) row = { ...row, flagBitNames: names };
    }
    if (isResourceRefRow(row) && row.ref.kind === "resource" && row.ref.type !== undefined) {
        // The declaration says WHAT it points at; the game is asked only whether it is there. The type is
        // stamped regardless, because it is what makes the field pickable - and the field a picker is most for
        // is the EMPTY one. An unresolvable resref is otherwise left exactly as it is: a mod record legitimately
        // points at what a later install step creates, so there is no marker and no advisory - only the open
        // affordance is withheld. A `deferred` ref never reaches here, so an opcode-typed effect resref renders
        // like an undeclared one.
        //
        // What a PRESENT resource then offers is a question about its type, not about the game: an editor that
        // can SHOW it earns the chip - a CRE points at five BCS scripts and a DLG, none of which anything here
        // reads, so the chip used to open six hex dumps per creature - and a type that IS a picture earns a
        // thumbnail, which is how an item's icon and a creature's portraits draw in the row.
        const resref = row.rawValue;
        const target = lookups.resourceType({ type: row.ref.type, byFlavour: row.ref.byFlavour }, resref);
        if (target !== undefined) {
            row = { ...row, refExt: target.type };
            if (target.present) row = { ...row, ...affordancesFor(resref, target.type, lookups) };
        }
    }
    if (isSlotRefRow(row)) {
        const { ref, index } = row.slotRef;
        const identifier =
            ref.kind === "ids" && ref.tables !== undefined ? lookups.slotLabel(ref.tables, index) : undefined;
        // The slot's own number is kept rather than the IDS value so the label reads consistently against the
        // unresolved slots beside it (the tail of a sound-set block has no IDS entry); they differ by one.
        if (identifier !== undefined) row = { ...row, name: `${index + 1} ${identifier}` };
    }
    // A row that resolved is returned without descending into it. Sound because every shape matched above is a
    // LEAF - a field carries scalars, and only a group carries children, which no guard here matches. Stated
    // rather than assumed: this module deliberately does not import the row types, so nothing else would catch
    // a future shape that carries both a `ref` and nested rows.
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
