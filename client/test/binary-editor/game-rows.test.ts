import { describe, expect, it, vi } from "vitest";
import { withGameContext } from "../../src/binary-editor/game-rows";

const LINE = "Ring of Protection +1";

/** The candidate tables the host reports as present, in declaration order - what `namingTable` answers with. */
type Named = readonly { table: string; entries: ReadonlyMap<number, string> }[] | undefined;
const one = (table: string, entries: readonly (readonly [number, string])[]): Named => [
    { table, entries: new Map(entries) },
];

/**
 * The option list a row came out with. A cast because `withGameContext` is generic over the message shape and
 * returns it unchanged, so a row literal that declares no vendored `enumOptions` - which is exactly the shape
 * of the fields the game alone names - has no such property to read back.
 */
const optionsOf = (row: unknown): Record<string, string> | undefined =>
    (row as { enumOptions?: Record<string, string> }).enumOptions;

const lookups = {
    strref: (strref: number): string | undefined => (strref === 6348 ? LINE : undefined),
    slotLabel: (): string | undefined => undefined,
    namingTable: (): Named => undefined,
    resourceType: (): { type: string; present: boolean } | undefined => undefined,
};

/** A game whose RACE.IDS names 1 and 6; 2 is left to the vendored table so the gap-fill direction is visible. */
const withRaceIds = {
    ...lookups,
    namingTable: (_kind: string, tables: readonly string[]): Named =>
        tables[0] === "RACE"
            ? one("RACE", [
                  [1, "HUMAN"],
                  [6, "GNOME"],
              ])
            : undefined,
};

const strrefRow = { id: "f1", kind: "field", name: "Unidentified Name", ref: { kind: "strref" }, rawValue: 6348 };
const plainRow = { id: "f2", kind: "field", name: "Weight", rawValue: 37 };

describe("withGameContext", () => {
    it("fills strrefText on a strref row nested in a message", () => {
        const message = { type: "children", requestId: 3, rows: [plainRow, strrefRow] };

        const out = withGameContext(message, lookups);

        expect(out.rows[1]).toMatchObject({ id: "f1", rawValue: 6348, strrefText: LINE });
        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    it("reaches rows at any depth, so a new row-bearing message shape needs no change here", () => {
        const message = { type: "init", open: { rootWindow: [{ kind: "group", children: [strrefRow] }] } };

        const out = withGameContext(message, lookups);

        expect(out.open.rootWindow[0]?.children[0]).toHaveProperty("strrefText", LINE);
    });

    it("leaves a strref the TLK cannot resolve untouched", () => {
        const out = withGameContext({ rows: [{ ...strrefRow, rawValue: 999 }] }, lookups);

        expect(out.rows[0]).not.toHaveProperty("strrefText");
    });

    // Structural sharing is what keeps this affordable at the post choke point: a record with no game behind it
    // resolves nothing, and must not pay a deep clone of every message.
    it("returns the identical object when nothing resolved", () => {
        const message = { type: "children", rows: [plainRow, { ...strrefRow, rawValue: 999 }] };

        expect(withGameContext(message, lookups)).toBe(message);
    });

    it("shares the untouched branches of a message it did change", () => {
        const untouched = { deep: { rows: [plainRow] } };
        const message = { untouched, changed: [strrefRow] };

        const out = withGameContext(message, lookups);

        expect(out).not.toBe(message);
        expect(out.untouched).toBe(untouched);
    });

    it("does not re-resolve a row that already carries text", () => {
        const spy = vi.fn(lookups.strref);

        withGameContext({ rows: [{ ...strrefRow, strrefText: "already there" }] }, { ...lookups, strref: spy });

        expect(spy).not.toHaveBeenCalled();
    });

    // A slot named by the game's own IDS table (a CRE sound slot): the parser emits which tables name it and
    // at which index, and the host - which holds the game - turns that into the row's label.
    it("names an IDS-backed slot from the game's table", () => {
        const slotRow = {
            id: "s1",
            kind: "field",
            name: "Sound 22",
            slotRef: { ref: { kind: "ids", tables: ["SNDSLOT"] }, index: 21 },
        };
        const named = {
            ...lookups,
            slotLabel: (tables: readonly string[], index: number) =>
                tables[0] === "SNDSLOT" && index === 21 ? "AREA_FOREST" : undefined,
        };

        const out = withGameContext({ rows: [slotRow] }, named);

        expect(out.rows[0]).toMatchObject({ id: "s1", name: "22 AREA_FOREST" });
    });

    it("keeps the generic slot label when the game has no name for it", () => {
        const slotRow = {
            id: "s2",
            kind: "field",
            name: "Sound 90",
            slotRef: { ref: { kind: "ids", tables: ["SNDSLOT"] }, index: 89 },
        };

        const out = withGameContext({ rows: [slotRow] }, lookups);

        expect(out.rows[0]).toMatchObject({ name: "Sound 90" });
    });

    // An IDS-backed enum: the vendored table is a small baseline, the install's own is richer and mod-extended.
    // Game wins per value, vendored fills the gaps - so neither table alone decides the option list.
    it("merges the game's IDS table over the vendored enum, keeping vendored gaps", () => {
        const race = {
            id: "r1",
            kind: "field",
            name: "Race",
            valueType: "enum",
            ref: { kind: "ids", tables: ["RACE"] },
            rawValue: 1,
            enumOptions: { "1": "Human", "2": "Elf" },
        };

        const out = withGameContext({ rows: [race] }, withRaceIds);

        // 1 overridden by the game, 2 kept from vendored, 6 added by the game.
        expect(out.rows[0]?.enumOptions).toEqual({ "1": "HUMAN", "2": "Elf", "6": "GNOME" });
    });

    /**
     * A projectile field is named by MISSILE.IDS and PROJECTL.IDS at once, and which one carries the value is
     * per-install: BG:EE ships a full 365-entry MISSILE while BG2 classic ships a 29-entry stub beside a full
     * PROJECTL. So every present candidate contributes, and the declaration's order decides only who wins a key
     * they both name - taking the first table outright leaves BG2 classic mostly unnamed.
     */
    it("merges every candidate table the install ships, earlier ones winning a shared key", () => {
        const projectile = {
            id: "p1",
            kind: "field",
            name: "Projectile",
            valueType: "uint16",
            size: 2,
            ref: { kind: "ids", tables: ["MISSILE", "PROJECTL"] },
            rawValue: 2,
        };
        const named = {
            ...lookups,
            namingTable: (): Named => [
                { table: "MISSILE", entries: new Map([[2, "Arrow"]]) },
                {
                    table: "PROJECTL",
                    entries: new Map([
                        [2, "LOSES_TO_MISSILE"],
                        [7, "AXEEX"],
                    ]),
                },
            ],
        };

        const out = withGameContext({ rows: [projectile] }, named);

        // No vendored table on this field, so the merge is also what turns it into a dropdown at all.
        expect(out.rows[0]).toMatchObject({ valueType: "enum", enumOpen: true });
        expect(optionsOf(out.rows[0])).toEqual({ "2": "Arrow", "7": "AXEEX" });
    });

    // The encoding is declared per TABLE, so one candidate can be keyed as the field stores it while the other
    // sits at an offset: stored 2 is MISSILE key 2 and PROJECTL key 1, both naming an arrow.
    it("applies each candidate's own key encoding, not one encoding for the whole declaration", () => {
        const projectile = {
            id: "p2",
            kind: "field",
            name: "Projectile",
            valueType: "uint16",
            size: 2,
            ref: { kind: "ids", tables: ["MISSILE", "PROJECTL"], keyEncoding: { PROJECTL: "keyPlusOne" } },
            rawValue: 2,
        };
        const named = {
            ...lookups,
            namingTable: (): Named => [
                { table: "MISSILE", entries: new Map([[1, "None"]]) },
                {
                    table: "PROJECTL",
                    entries: new Map([
                        [1, "ARROW"],
                        [6, "AXE"],
                    ]),
                },
            ],
        };

        const out = withGameContext({ rows: [projectile] }, named);

        // MISSILE's key 1 stays at 1; PROJECTL's 1 and 6 shift to the 2 and 7 the field actually stores.
        expect(optionsOf(out.rows[0])).toEqual({ "1": "None", "2": "ARROW", "7": "AXE" });
    });

    /**
     * PROJECTL.IDS symbols are `.PRO` resource basenames, so a projectile VALUE identifies a real file - the
     * open chip beside it is the same affordance a resref field gets, reached from a number. Near Infinity
     * carries the same pairing on this field.
     */
    it("offers to open the resource a numeric value names through its table's symbol", () => {
        const projectile = {
            id: "p3",
            kind: "field",
            name: "Projectile",
            valueType: "uint16",
            size: 2,
            ref: {
                kind: "ids",
                tables: ["PROJECTL"],
                keyEncoding: { PROJECTL: "keyPlusOne" },
                symbolResource: { table: "PROJECTL", type: "PRO" },
            },
            rawValue: 108,
        };
        const named = {
            ...lookups,
            namingTable: (): Named => one("PROJECTL", [[107, "ACIDBLOB"]]),
            // The symbol is looked up at the value's own KEY - 108 stored is PROJECTL 107, not 108.
            resourceType: (decl: { type: string }, resref: string) =>
                decl.type === "PRO" && resref === "ACIDBLOB" ? { type: "PRO", present: true } : undefined,
        };

        const out = withGameContext({ rows: [projectile] }, named);

        expect(out.rows[0]).toMatchObject({ openTarget: { resref: "ACIDBLOB", ext: "PRO" } });
        // Openable, never pickable: the field stores a number from a named list, so it must not turn into a
        // resref picker the way a `kind: "resource"` field does.
        expect(out.rows[0]).not.toHaveProperty("refExt");
    });

    // Same rule as a resref: an install that does not have the file gets no chip rather than a dangling one.
    it("withholds the chip when the game cannot resolve the named resource", () => {
        const projectile = {
            id: "p4",
            kind: "field",
            name: "Projectile",
            valueType: "uint16",
            size: 2,
            ref: { kind: "ids", tables: ["PROJECTL"], symbolResource: { table: "PROJECTL", type: "PRO" } },
            rawValue: 5,
        };
        const named = {
            ...lookups,
            namingTable: (): Named => one("PROJECTL", [[5, "MODONLY"]]),
            resourceType: () => ({ type: "PRO", present: false }),
        };

        const out = withGameContext({ rows: [projectile] }, named);

        expect(out.rows[0]).not.toHaveProperty("openTarget");
    });

    // MISSILE.IDS symbols are labels with no file behind them, so a value named only by the co-candidate is
    // named but not openable - which is why the declaration names the table rather than applying to all.
    it("derives the resource only from the table the ref names, not from a co-candidate", () => {
        const projectile = {
            id: "p5",
            kind: "field",
            name: "Projectile",
            valueType: "uint16",
            size: 2,
            ref: {
                kind: "ids",
                tables: ["PROJECTL", "MISSILE"],
                keyEncoding: { PROJECTL: "keyPlusOne" },
                symbolResource: { table: "PROJECTL", type: "PRO" },
            },
            rawValue: 300,
        };
        const named = {
            ...lookups,
            namingTable: (): Named => [
                { table: "PROJECTL", entries: new Map([[107, "ACIDBLOB"]]) },
                { table: "MISSILE", entries: new Map([[300, "Label_Only"]]) },
            ],
            resourceType: () => ({ type: "PRO", present: true }),
        };

        const out = withGameContext({ rows: [projectile] }, named);

        expect(optionsOf(out.rows[0])?.["300"]).toBe("Label_Only");
        expect(out.rows[0]).not.toHaveProperty("openTarget");
    });

    it("leaves the vendored enum untouched when the game has no such table", () => {
        const clazz = {
            id: "c1",
            kind: "field",
            name: "Class",
            valueType: "enum",
            ref: { kind: "ids", tables: ["CLASS"] },
            rawValue: 2,
            enumOptions: { "2": "Mage" },
        };

        const out = withGameContext({ rows: [clazz] }, withRaceIds);

        expect(out.rows[0]?.enumOptions).toEqual({ "2": "Mage" });
    });

    // CRE animationId has NO vendored table - a bare 0x6100 names nothing - so with a game it must become a
    // named dropdown, not stay a plain number input. Open, so an unnamed animation is still editable.
    it("turns a plain number with no vendored table into an open enum when the game names it", () => {
        const anim = {
            id: "a1",
            kind: "field",
            name: "Animation Id",
            valueType: "uint32",
            ref: { kind: "ids", tables: ["ANIMATE"] },
            rawValue: 24832,
        };
        const named = { ...lookups, namingTable: () => one("ANIMATE", [[24832, "MFIE_BAAL"]]) };

        const out = withGameContext({ rows: [anim] }, named);

        expect(out.rows[0]).toMatchObject({
            valueType: "enum",
            enumOpen: true,
            enumOptions: { "24832": "MFIE_BAAL" },
        });
    });

    // A CRE kit dword stores the KIT.IDS key in its HIGH WORD (0x4003 KENSAI is stored 0x40030000), verified
    // across the 4020-CRE BG2 corpus: 19 of the 20 distinct stored values are that shift, and none is a raw
    // key. Merged unshifted, the table contributes options the field can never hold.
    it("swaps an IDS key's words into the field's own encoding when the ref declares it", () => {
        const kit = {
            id: "k1",
            kind: "field",
            name: "Kit",
            valueType: "enum",
            size: 4,
            ref: { kind: "ids", tables: ["KIT"], keyEncoding: { KIT: "swappedWords" } },
            rawValue: 0x4003_0000,
            enumOptions: { "1073938432": "Kensai" },
        };
        const named = { ...lookups, namingTable: () => one("KIT", [[0x4003, "KENSAI"]]) };

        const out = withGameContext({ rows: [kit] }, named);

        // Keyed at the stored dword, not at the table's 0x4003 - and overriding the vendored label there.
        expect(out.rows[0]?.enumOptions).toEqual({ "1073938432": "KENSAI" });
    });

    // The EE and IWD2 tables key some kits in the OTHER word - BARBARIAN is 0x40000000 - and the swap maps
    // those to a stored 0x4000 rather than off the end of the field. A plain shift dropped them entirely.
    it("names a key held in the high word, which a shift would push out of the field", () => {
        const kit = {
            id: "k2",
            kind: "field",
            name: "Kit",
            valueType: "enum",
            size: 4,
            ref: { kind: "ids", tables: ["KIT"], keyEncoding: { KIT: "swappedWords" } },
            rawValue: 0,
            enumOptions: {},
        };
        const named = {
            ...lookups,
            namingTable: () =>
                one("KIT", [
                    [0x4003, "KENSAI"],
                    [0x4000_0000, "BARBARIAN"],
                    [0x8000_0000, "WILDMAGE"],
                ]),
        };

        const out = withGameContext({ rows: [kit] }, named);

        expect(out.rows[0]?.enumOptions).toEqual({
            "1073938432": "KENSAI",
            "16384": "BARBARIAN",
            "32768": "WILDMAGE",
        });
    });

    // The swap is an involution, so it is the same operation in both directions: the value a record stores
    // maps back to exactly the table key it came from.
    it("round-trips a stored value back to its table key", () => {
        const kit = {
            id: "k3",
            kind: "field",
            name: "Kit",
            valueType: "enum",
            size: 4,
            ref: { kind: "ids", tables: ["KIT"], keyEncoding: { KIT: "swappedWords" } },
            rawValue: 0x4000,
            enumOptions: {},
        };
        // TRUE_CLASS is 0x4000, the no-kit marker: it stores as 0x40000000, the commonest value in the corpus.
        const named = {
            ...lookups,
            namingTable: () =>
                one("KIT", [
                    [0x4000, "TRUE_CLASS"],
                    [0x4000_0000, "BARBARIAN"],
                ]),
        };

        const out = withGameContext({ rows: [kit] }, named);

        expect(out.rows[0]?.enumOptions).toEqual({ "1073741824": "TRUE_CLASS", "16384": "BARBARIAN" });
    });

    // A key whose low word has the top bit set lands in the stored dword's HIGH word, past the signed-int32
    // range. The option key must be the unsigned value the field holds, not a negative one no row can match.
    it("keeps a key that swaps into the top bit unsigned", () => {
        const kit = {
            id: "k4",
            kind: "field",
            name: "Kit",
            valueType: "enum",
            size: 4,
            ref: { kind: "ids", tables: ["KIT"], keyEncoding: { KIT: "swappedWords" } },
            rawValue: 0,
            enumOptions: {},
        };
        const named = { ...lookups, namingTable: () => one("KIT", [[0x8000, "HIGHBIT"]]) };

        const out = withGameContext({ rows: [kit] }, named);

        expect(out.rows[0]?.enumOptions).toEqual({ "2147483648": "HIGHBIT" });
    });

    /**
     * IDS files are plain text and mods write what they like, so a table can carry a negative key. The upper
     * bound already drops a key too large for the field; a negative one is just as unstorable, and offering it
     * would put an option in the dropdown that no value of the field can ever select.
     */
    it("drops a table key the field cannot hold, at either end of its range", () => {
        const sex = {
            id: "x1",
            kind: "field",
            name: "Sex",
            valueType: "enum",
            size: 1,
            ref: { kind: "ids", tables: ["GENDER"] },
            rawValue: 1,
            enumOptions: {},
        };
        const named = {
            ...lookups,
            namingTable: () =>
                one("GENDER", [
                    [-1, "NEGATIVE"],
                    [1, "MALE"],
                    [256, "TOO_WIDE"],
                ]),
        };

        const out = withGameContext({ rows: [sex] }, named);

        expect(out.rows[0]?.enumOptions).toEqual({ "1": "MALE" });
    });

    // A 2DA-backed field (an EFF magic school) resolves through the same merge as an IDS one - only the source
    // resource differs - so the kind has to reach the lookup rather than being assumed to be IDS.
    it("names a 2DA-backed field from the game's row-name table", () => {
        const school = {
            id: "s1",
            kind: "field",
            name: "School",
            valueType: "enum",
            size: 1,
            ref: { kind: "2da", tables: ["MSCHOOL"] },
            rawValue: 1,
            enumOptions: { "1": "Abjurer" },
        };
        const named = {
            ...lookups,
            namingTable: (kind: string, tables: readonly string[]) =>
                kind === "2da" && tables[0] === "MSCHOOL" ? one("MSCHOOL", [[1, "ABJURER"]]) : undefined,
        };

        const out = withGameContext({ rows: [school] }, named);

        expect(out.rows[0]?.enumOptions).toEqual({ "1": "ABJURER" });
    });

    // A resref the open game actually has becomes openable: the host resolves WHICH of the declared candidate
    // types exists, so the webview can offer to open it without knowing anything about the game.
    const iconRow = {
        id: "i1",
        kind: "field",
        name: "Inventory Icon",
        valueType: "string",
        ref: { kind: "resource", type: "BAM" },
        rawValue: "ISW1H01",
    };

    /** A game that has ISW1H01.BAM. Every BAM-typed field resolves to the type; only that name is present. */
    const hasIcon = {
        ...lookups,
        resourceType: (decl: { type: string }, resref: string) =>
            decl.type === "BAM" ? { type: "BAM", present: resref === "ISW1H01" } : undefined,
    };

    it("marks a resref the game can open, naming the type that resolved", () => {
        const out = withGameContext({ rows: [iconRow] }, hasIcon);

        expect(out.rows[0]).toMatchObject({ openTarget: { resref: "ISW1H01", ext: "BAM" } });
    });

    // Never judge: a mod file legitimately points at what a later install step creates, so an unresolvable
    // resref gets no marker and no advisory - only the open affordance is withheld. The TYPE still lands,
    // because that follows from the record and the game, not from the value.
    it("withholds the open affordance for a resref the game does not have, but keeps it pickable", () => {
        const out = withGameContext({ rows: [{ ...iconRow, rawValue: "MODONLY" }] }, hasIcon);

        expect(out.rows[0]).not.toHaveProperty("openTarget");
        expect(out.rows[0]).toMatchObject({ refExt: "BAM" });
    });

    // The empty field is exactly the one a picker exists for, so it carries the type - but there is no resource
    // to open, so no affordance.
    it("makes an empty resref pickable without offering to open it", () => {
        const out = withGameContext({ rows: [{ ...iconRow, rawValue: "" }] }, hasIcon);

        expect(out.rows[0]).toMatchObject({ refExt: "BAM" });
        expect(out.rows[0]).not.toHaveProperty("openTarget");
    });

    // Outside a game there is nothing to resolve and nothing to suggest: the field stays a plain text box.
    it("leaves a resref untouched when the record is not from a game", () => {
        const out = withGameContext({ rows: [iconRow] }, lookups);

        expect(out.rows[0]).not.toHaveProperty("openTarget");
        expect(out.rows[0]).not.toHaveProperty("refExt");
    });

    // A CRE sound slot is BOTH: a strref (the line it points at) and an IDS-named slot (its label). The real
    // row carries both, so filling one must not skip the other.
    it("fills the line AND the slot name on a row that is both", () => {
        const soundSlot = {
            id: "s3",
            kind: "field",
            name: "Sound 22",
            ref: { kind: "strref" },
            rawValue: 6348,
            slotRef: { ref: { kind: "ids", tables: ["SNDSLOT"] }, index: 21 },
        };
        const named = { ...lookups, slotLabel: () => "AREA_FOREST" };

        const out = withGameContext({ rows: [soundSlot] }, named);

        expect(out.rows[0]).toMatchObject({ name: "22 AREA_FOREST", strrefText: LINE });
    });
});
