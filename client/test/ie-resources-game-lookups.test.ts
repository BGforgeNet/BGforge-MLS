import { describe, it, expect, vi } from "vitest";

// The resolver only reads uri.scheme/query, so mock vscode.Uri as the parts holder (same shape as the
// ie-resources-uri test) rather than pulling in vscode.Uri internals.
vi.mock("vscode", () => ({ Uri: { from: (parts: unknown) => parts } }));

// Imported after vi.mock so the mocked vscode is in place.
import type { IeScriptStyle, TwoDaTable } from "@bgforge/binary";
import {
    createBcsSymbolResolver,
    createFlagBitNamesResolver,
    createNamingTableResolver,
    createResourceListResolver,
    createResourceBytesResolver,
    createResourceTypeResolver,
    createSlotLabelResolver,
    createStrrefResolver,
    isGameDocument,
} from "../src/ie-resources/game-lookups";
import { GAME_RESOURCE_SCHEME } from "../src/ie-resources/uri";

const LINES: Record<number, string> = { 6348: "Ring of Protection +1", 72909: "" };

const TABLES: Record<string, ReadonlyMap<number, string>> = {
    // The two a compiled script's every call is named through, plus one enumerated object field.
    trigger: new Map([[0x4030, "False()"]]),
    action: new Map([[36, "Continue()"]]),
    ea: new Map([[2, "PC"]]),
    sndslot: new Map([[21, "AREA_FOREST"]]),
    soundoff: new Map([
        [21, "AREA_FOREST_BG1"],
        [35, "SELECT_RARE"],
    ]),
};

function session(
    overrides: {
        throws?: boolean;
        noTlk?: boolean;
        tables?: string[];
        twoDa?: string[];
        resources?: string[];
        flavour?: string;
        scriptStyle?: IeScriptStyle;
        kitlist?: TwoDaTable;
    } = {},
): {
    ensureOpen: (dir: string) => {
        tlk: () => { get: (n: number) => string | undefined } | undefined;
        ids: (resref: string) => ReadonlyMap<number, string> | undefined;
        idsAll: (resref: string) => ReadonlyMap<number, readonly string[]> | undefined;
        twoDa: (resref: string) => ReadonlyMap<number, string> | undefined;
        twoDaTable: (resref: string) => TwoDaTable | undefined;
        canRead: (resref: string, type: string) => boolean;
        read: (resref: string, type: string) => Uint8Array;
        list: () => { resref: string; ext: string | undefined }[];
        identity: { flavour: string; scriptStyle: IeScriptStyle };
    };
} {
    return {
        ensureOpen: (dir: string) => {
            if (overrides.throws === true) throw new Error(`no game at ${dir}`);
            return {
                tlk: () => (overrides.noTlk === true ? undefined : { get: (n: number) => LINES[n] }),
                ids: (resref: string) =>
                    (overrides.tables ?? []).includes(resref.toLowerCase()) ? TABLES[resref.toLowerCase()] : undefined,
                // Every row per value, which is what a script decompiler reads. The fake tables hold one row
                // each, so this is the same content in the shape `idsAll` promises.
                idsAll: (resref: string) => {
                    const table = (overrides.tables ?? []).includes(resref.toLowerCase())
                        ? TABLES[resref.toLowerCase()]
                        : undefined;
                    return table === undefined
                        ? undefined
                        : new Map([...table].map(([value, name]) => [value, [name]]));
                },
                twoDa: (resref: string) =>
                    (overrides.twoDa ?? []).includes(resref.toLowerCase()) ? TABLES[resref.toLowerCase()] : undefined,
                twoDaTable: (resref: string) => (resref.toLowerCase() === "kitlist" ? overrides.kitlist : undefined),
                canRead: (resref: string, type: string) =>
                    (overrides.resources ?? []).includes(`${resref}.${type}`.toLowerCase()),
                // Stands in for the real archive read: identifiable bytes for a resource the install has, and a
                // throw for one it does not - the real `Game.read` throws, which is why the resolver asks
                // `canRead` first rather than catching.
                read: (resref: string, type: string) => {
                    if (!(overrides.resources ?? []).includes(`${resref}.${type}`.toLowerCase()))
                        throw new Error(`no ${resref}.${type}`);
                    return new TextEncoder().encode(`${resref}.${type}`.toLowerCase());
                },
                // The install's whole namespace, biffed and override alike - `resources` doubles as it, split
                // back into the resref/ext pair `Game.list()` yields.
                list: () =>
                    (overrides.resources ?? []).map((name) => {
                        const dot = name.lastIndexOf(".");
                        return { resref: name.slice(0, dot).toUpperCase(), ext: name.slice(dot + 1) };
                    }),
                identity: { flavour: overrides.flavour ?? "tob", scriptStyle: overrides.scriptStyle ?? "bg2" },
            };
        },
    };
}

function gameUri(gameDir = "/games/tob"): never {
    // Cast-free: the resolver reads only these two members off the URI.
    return { scheme: GAME_RESOURCE_SCHEME, query: `g=${encodeURIComponent(gameDir)}`, path: "/sw1h01.itm" } as never;
}

/**
 * The one place that decides whether a document is backed by a game. Every resolver already answered this
 * question privately; naming it lets a caller ask BEFORE doing work whose result would be discarded - the
 * binary editor walks each host-to-webview message looking for rows to resolve, which for a record outside a
 * game is a full traversal that can only ever produce nothing.
 */
describe("isGameDocument", () => {
    it("accepts a game-resource URI carrying a game directory", () => {
        expect(isGameDocument(gameUri())).toBe(true);
    });

    // Differs from a game URI ONLY by scheme - it still carries a `g=` query - so a dropped scheme check
    // cannot pass this by falling through to the empty-gameDir case.
    it("rejects a document of another scheme, even with a game query", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/sw1h01.itm" } as never;

        expect(isGameDocument(fileUri)).toBe(false);
    });

    it("rejects a game-resource URI with no game directory", () => {
        const noDir = { scheme: GAME_RESOURCE_SCHEME, query: "", path: "/sw1h01.itm" } as never;

        expect(isGameDocument(noDir)).toBe(false);
    });
});

/**
 * A mod's own record is a plain `file:` document, so the caller-supplied fallback (the configured game path,
 * or the open game) decides what it resolves against. The fallback must never leak beyond `file:` documents,
 * and a game URI's own directory must always win over it.
 */
describe("file-record fallback", () => {
    const fileUri = { scheme: "file", query: "", path: "/mods/mymod/sw1h01.itm" } as never;

    it("treats a file document as game-backed when the fallback names a game", () => {
        expect(isGameDocument(fileUri, () => "/games/tob")).toBe(true);
    });

    it("stays unbacked when the fallback has no game to offer", () => {
        expect(isGameDocument(fileUri, () => undefined)).toBe(false);
    });

    it("never applies the fallback to schemes other than file", () => {
        const untitled = { scheme: "untitled", query: "", path: "/sw1h01.itm" } as never;

        expect(isGameDocument(untitled, () => "/games/tob")).toBe(false);
    });

    it("resolves a file record's strref against the fallback game", () => {
        const opened: string[] = [];
        const base = session();
        const spied = {
            ensureOpen: (dir: string) => {
                opened.push(dir);
                return base.ensureOpen(dir);
            },
        };

        const line = createStrrefResolver(spied, () => "/games/tob")(fileUri, 6348);

        expect(line).toBe("Ring of Protection +1");
        expect(opened).toEqual(["/games/tob"]);
    });

    // A file URI can carry any query; only the dedicated scheme makes a URI self-describing, so a `g=` query
    // on a file document must not outrank the policy's answer.
    it("ignores a g= query on a file document in favour of the fallback", () => {
        const queried = { scheme: "file", query: "g=%2Fgames%2Felsewhere", path: "/mods/sw1h01.itm" } as never;
        const opened: string[] = [];
        const base = session();
        const spied = {
            ensureOpen: (dir: string) => {
                opened.push(dir);
                return base.ensureOpen(dir);
            },
        };

        createStrrefResolver(spied, () => "/games/tob")(queried, 6348);

        expect(opened).toEqual(["/games/tob"]);
    });

    it("lets a game URI's own directory win over the fallback", () => {
        const opened: string[] = [];
        const base = session();
        const spied = {
            ensureOpen: (dir: string) => {
                opened.push(dir);
                return base.ensureOpen(dir);
            },
        };

        createStrrefResolver(spied, () => "/games/other")(gameUri("/games/tob"), 6348);

        expect(opened).toEqual(["/games/tob"]);
    });
});

describe("createStrrefResolver", () => {
    it("resolves a strref against the game the URI names", () => {
        expect(createStrrefResolver(session())(gameUri(), 6348)).toBe("Ring of Protection +1");
    });

    // Carries a `g=` query, so it differs from a game URI ONLY by scheme: with an empty query the later
    // "no gameDir" check rejects it too, and the test passes even with the scheme guard gone.
    it("resolves nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/sw1h01.itm" } as never;

        expect(createStrrefResolver(session())(fileUri, 6348)).toBeUndefined();
    });

    // -1 is the format-wide "no string" sentinel, so it must never reach the TLK (where it would either miss
    // or, worse, wrap into a real entry).
    it("resolves nothing for the -1 sentinel", () => {
        const get = vi.fn();
        const spySession = {
            ensureOpen: () => ({
                tlk: () => ({ get }),
                ids: () => undefined,
                idsAll: () => undefined,
                twoDa: () => undefined,
                twoDaTable: () => undefined,
                canRead: () => false,
                read: (): Uint8Array => {
                    throw new Error("empty game");
                },
                list: () => [],
                identity: { flavour: "tob", scriptStyle: "bg2" as const },
            }),
        };

        expect(createStrrefResolver(spySession)(gameUri(), -1)).toBeUndefined();
        expect(get).not.toHaveBeenCalled();
    });

    // A CRE leaves unused sound slots pointing at an empty entry; showing it would render a trailing space in
    // the field and a blank tooltip.
    it("treats an empty TLK line as unresolved", () => {
        expect(createStrrefResolver(session())(gameUri(), 72909)).toBeUndefined();
    });

    it("resolves nothing when the strref is absent from the TLK", () => {
        expect(createStrrefResolver(session())(gameUri(), 999999)).toBeUndefined();
    });

    it("resolves nothing when the game has no TLK", () => {
        expect(createStrrefResolver(session({ noTlk: true }))(gameUri(), 6348)).toBeUndefined();
    });

    // An unreadable game must not fail the editor open - the field falls back to showing its number.
    it("swallows an unopenable game", () => {
        expect(createStrrefResolver(session({ throws: true }))(gameUri(), 6348)).toBeUndefined();
    });
});

describe("createSlotLabelResolver", () => {
    it("names a slot from the game's IDS table", () => {
        const resolve = createSlotLabelResolver(session({ tables: ["sndslot"] }));

        expect(resolve(gameUri(), ["SNDSLOT", "SOUNDOFF"], 21)).toBe("AREA_FOREST");
    });

    // A BG2 install ships both tables and they disagree at the same index, so preference order has to decide
    // rather than a merge - SNDSLOT wins where present.
    it("prefers the first table the game ships, not a merge of both", () => {
        const resolve = createSlotLabelResolver(session({ tables: ["sndslot", "soundoff"] }));

        expect(resolve(gameUri(), ["SNDSLOT", "SOUNDOFF"], 21)).toBe("AREA_FOREST");
        // Only the fallback names slot 35, so it still answers there.
        expect(resolve(gameUri(), ["SNDSLOT", "SOUNDOFF"], 35)).toBe("SELECT_RARE");
    });

    it("falls back to the next table when the preferred one is absent", () => {
        const resolve = createSlotLabelResolver(session({ tables: ["soundoff"] }));

        expect(resolve(gameUri(), ["SNDSLOT", "SOUNDOFF"], 21)).toBe("AREA_FOREST_BG1");
    });

    it("names nothing for a slot no table covers", () => {
        const resolve = createSlotLabelResolver(session({ tables: ["sndslot"] }));

        expect(resolve(gameUri(), ["SNDSLOT", "SOUNDOFF"], 90)).toBeUndefined();
    });

    it("names nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.cre" } as never;

        expect(createSlotLabelResolver(session({ tables: ["sndslot"] }))(fileUri, ["SNDSLOT"], 21)).toBeUndefined();
    });
});

describe("createNamingTableResolver", () => {
    it("returns the whole table, so a consumer can build an option list from it", () => {
        const resolve = createNamingTableResolver(session({ tables: ["sndslot"] }));

        expect(resolve(gameUri(), "ids", ["SNDSLOT"])).toEqual([
            { table: "SNDSLOT", entries: new Map([[21, "AREA_FOREST"]]) },
        ]);
    });

    // Every present candidate is reported, tagged with the table it came from, because the caller needs both:
    // which key encoding to apply (declared per table) and which name wins a key two tables share.
    it("reports every candidate the game ships, in declaration order", () => {
        const resolve = createNamingTableResolver(session({ tables: ["sndslot", "soundoff"] }));

        expect(resolve(gameUri(), "ids", ["SNDSLOT", "SOUNDOFF"])?.map((t) => t.table)).toEqual([
            "SNDSLOT",
            "SOUNDOFF",
        ]);
    });

    it("reports only the candidates present when the preferred one is absent", () => {
        const resolve = createNamingTableResolver(session({ tables: ["soundoff"] }));

        expect(resolve(gameUri(), "ids", ["SNDSLOT", "SOUNDOFF"])).toEqual([
            { table: "SOUNDOFF", entries: TABLES["soundoff"] },
        ]);
    });

    it("returns nothing when the game ships none of the candidates", () => {
        expect(createNamingTableResolver(session())(gameUri(), "ids", ["RACE"])).toBeUndefined();
    });

    it("returns nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.cre" } as never;

        expect(
            createNamingTableResolver(session({ tables: ["sndslot"] }))(fileUri, "ids", ["SNDSLOT"]),
        ).toBeUndefined();
    });

    // An unreadable game must not fail the open; the field falls back to its vendored table.
    it("swallows an unopenable game", () => {
        expect(createNamingTableResolver(session({ throws: true }))(gameUri(), "ids", ["SNDSLOT"])).toBeUndefined();
    });
});

describe("createResourceTypeResolver", () => {
    // ITM `replacement`: an item everywhere the parser accepts the record, a drop sound in PSTEE.
    const REPLACEMENT = { type: "ITM", byFlavour: { pstee: "WAV" } };

    it("answers with the declared type when the install has it", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }));

        expect(resolve(gameUri(), REPLACEMENT, "SW1H01")).toEqual({ type: "ITM", present: true });
    });

    it("answers with the flavour's own type where one is declared", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["drop01.wav"], flavour: "pstee" }));

        expect(resolve(gameUri(), REPLACEMENT, "DROP01")).toEqual({ type: "WAV", present: true });
    });

    // The declaration decides, not what happens to be installed: with BOTH resources present the answer still
    // follows the game. A presence probe would return whichever candidate it tried first and be wrong in one
    // of the two games - the reason this is not a candidate list.
    it("follows the flavour even when both types exist in the install", () => {
        const both = { resources: ["x.itm", "x.wav"] };

        expect(createResourceTypeResolver(session(both))(gameUri(), REPLACEMENT, "X")?.type).toBe("ITM");
        expect(
            createResourceTypeResolver(session({ ...both, flavour: "pstee" }))(gameUri(), REPLACEMENT, "X")?.type,
        ).toBe("WAV");
    });

    it("ignores a byFlavour entry for some other game", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["sw1h01.itm"], flavour: "bgee" }));

        expect(resolve(gameUri(), REPLACEMENT, "SW1H01")?.type).toBe("ITM");
    });

    // Never judges: a mod record legitimately references what a later install step creates. The TYPE still
    // holds - it follows from the record and the game - so the field stays pickable; only `present` is false,
    // and that is what withholds the open affordance.
    it("still names the type when the install does not have it", () => {
        expect(createResourceTypeResolver(session())(gameUri(), { type: "ITM" }, "NOPE")).toEqual({
            type: "ITM",
            present: false,
        });
    });

    // The empty field is the one a picker exists for, so it gets an answer - but "" is the "no resource"
    // value, so it never counts as present.
    it("names the type for an empty resref, which is never present", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }));

        expect(resolve(gameUri(), { type: "ITM" }, "")).toEqual({ type: "ITM", present: false });
    });

    it("answers nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.itm" } as never;

        expect(
            createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }))(fileUri, { type: "ITM" }, "SW1H01"),
        ).toBeUndefined();
    });

    // An unreadable game must not fail the open - the field just gets no affordance.
    it("swallows an unopenable game", () => {
        expect(
            createResourceTypeResolver(session({ throws: true }))(gameUri(), { type: "ITM" }, "SW1H01"),
        ).toBeUndefined();
    });
});

describe("createResourceBytesResolver", () => {
    const INSTALL = { resources: ["isw1h01.bam", "imoenm.bmp"] };

    it("reads a resource the install has", () => {
        const read = createResourceBytesResolver(session(INSTALL));

        expect(new TextDecoder().decode(read(gameUri(), "ISW1H01", "BAM"))).toBe("isw1h01.bam");
    });

    /**
     * The archive THROWS for an absent resource, and a resref naming what a later install step creates is the
     * normal case rather than an error - so the miss has to reach the caller as "no bytes", never as an
     * exception that would take the field beside it down.
     */
    it("answers nothing for a resource the install does not have, without throwing", () => {
        const read = createResourceBytesResolver(session(INSTALL));

        expect(read(gameUri(), "MODONLY", "BAM")).toBeUndefined();
    });

    // An unreadable game is the same answer as no game: nothing to draw, and nothing that fails an open.
    it("answers nothing when the game cannot be opened", () => {
        expect(createResourceBytesResolver(session({ throws: true }))(gameUri(), "ISW1H01", "BAM")).toBeUndefined();
    });

    it("answers nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.itm" } as never;

        expect(createResourceBytesResolver(session(INSTALL))(fileUri, "ISW1H01", "BAM")).toBeUndefined();
    });
});

describe("createResourceListResolver", () => {
    const INSTALL = { resources: ["sw1h01.itm", "misc01.itm", "isw1h01.bam", "drop01.wav"] };

    it("lists the install's resrefs of one type, sorted", () => {
        const list = createResourceListResolver(session(INSTALL));

        expect(list(gameUri(), "itm")).toEqual(["MISC01", "SW1H01"]);
    });

    // The declaration's type is upper-case ("BAM") while the index names extensions lower-case; a picker that
    // matched them literally would offer nothing for every field.
    it("matches the type case-insensitively", () => {
        const list = createResourceListResolver(session(INSTALL));

        expect(list(gameUri(), "BAM")).toEqual(["ISW1H01"]);
    });

    // Not an error and not undefined: a game can genuinely hold none of a type, and the picker then simply has
    // nothing to suggest while the field stays editable.
    it("answers an empty list for a type the install has none of", () => {
        expect(createResourceListResolver(session(INSTALL))(gameUri(), "spl")).toEqual([]);
    });

    // Undefined, distinct from empty: there is no game to ask, so the field is not a picker at all.
    it("answers nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.itm" } as never;

        expect(createResourceListResolver(session(INSTALL))(fileUri, "itm")).toBeUndefined();
    });

    it("swallows an unopenable game", () => {
        expect(createResourceListResolver(session({ throws: true }))(gameUri(), "itm")).toBeUndefined();
    });
});

/**
 * ITM kit-usability bits -> the install's kits, through the resolver the editor actually calls.
 *
 * The pure mapping is covered in `ie-resources-kit-usability.test.ts`; this pins the resolver's own decisions:
 * that it reads KITLIST.2DA off the session, resolves display names through the game's tlk, answers only for its
 * own ref kind, and reports "nothing" rather than an empty object so a bit falls back to its vendored label.
 */
describe("createFlagBitNamesResolver", () => {
    // Byte 3 bit 0x40 (mask 0x00004000) is what the Enhanced Editions pile their extra kits onto - the one bit
    // where the install genuinely knows more than the vendored table. One row's display strref resolves and the
    // other's does not, so both the tlk path and the identifier fallback are exercised.
    const KITLIST: TwoDaTable = {
        columns: ["ROWNAME", "LOWER", "MIXED", "UNUSABLE"],
        rows: [
            { name: "33", cells: ["SHADOWDANCER", "1", "6348", "0x00004000"] },
            { name: "34", cells: ["DWARVEN_DEFENDER", "2", "999999", "0x00004000"] },
        ],
    };

    it("names a shared bit with every kit the install maps onto it", () => {
        const resolve = createFlagBitNamesResolver(session({ kitlist: KITLIST }));

        expect(resolve(gameUri(), { kind: "itmKitUsability", byte: 3 })).toEqual({
            "64": ["Ring of Protection +1", "DWARVEN_DEFENDER"],
        });
    });

    it("answers nothing for a byte whose bits the install does not claim", () => {
        const resolve = createFlagBitNamesResolver(session({ kitlist: KITLIST }));

        expect(resolve(gameUri(), { kind: "itmKitUsability", byte: 1 })).toBeUndefined();
    });

    it("answers nothing when the install ships no KITLIST", () => {
        const resolve = createFlagBitNamesResolver(session());

        expect(resolve(gameUri(), { kind: "itmKitUsability", byte: 3 })).toBeUndefined();
    });

    // Another bit-ref kind would have its own table and its own key relation; answering for it would be a guess.
    it("declines a ref kind it does not own", () => {
        const resolve = createFlagBitNamesResolver(session({ kitlist: KITLIST }));

        expect(resolve(gameUri(), { kind: "somethingElse", byte: 3 })).toBeUndefined();
    });

    it("answers nothing when the game cannot be opened", () => {
        const resolve = createFlagBitNamesResolver(session({ throws: true, kitlist: KITLIST }));

        expect(resolve(gameUri(), { kind: "itmKitUsability", byte: 3 })).toBeUndefined();
    });
});

/**
 * How a compiled script reads under its install: the tables that name its numbers, and the engine that says
 * which field each number is. Both come from one open game, so the resolver hands back one record.
 */
describe("createBcsSymbolResolver", () => {
    const naming = (overrides: Parameters<typeof session>[0] = {}) =>
        createBcsSymbolResolver(session({ tables: ["trigger", "action", "ea"], ...overrides }))(gameUri());

    it("names triggers and actions from the install's own tables", () => {
        const resolved = naming();

        expect(resolved?.symbols.trigger(0x4030)).toEqual(["False()"]);
        expect(resolved?.symbols.action(36)).toEqual(["Continue()"]);
        expect(resolved?.symbols.ids("EA")?.get(2)).toBe("PC");
    });

    // Signatures come through `idsAll`, so an id the table never names is an empty list, not undefined - the
    // decompiler reads "no row for this id" and degrades to `UnknownTrigger<id>()` rather than failing.
    it("reports no rows for an id the install does not name", () => {
        const resolved = naming();

        expect(resolved?.symbols.trigger(0x9999)).toEqual([]);
        expect(resolved?.symbols.action(9999)).toEqual([]);
    });

    it("reports no table the install does not ship", () => {
        expect(naming()?.symbols.ids("SUBRACE")).toBeUndefined();
    });

    // The engine decides which table names each object field, and nothing in a script says which game wrote it.
    it("takes the engine from the game's detected script style", () => {
        expect(naming()?.engine).toBe("bg");
        expect(naming({ scriptStyle: "pst" })?.engine).toBe("pst");
        expect(naming({ scriptStyle: "iwd1" })?.engine).toBe("iwd");
        expect(naming({ scriptStyle: "iwd2" })?.engine).toBe("iwd2");
    });

    it("resolves nothing for a document with no game behind it", () => {
        expect(createBcsSymbolResolver(session())({ scheme: "file", path: "/mod/a.bcs" } as never)).toBeUndefined();
    });

    // An unreadable game reads as "no game", exactly as a document outside one does.
    it("resolves nothing when the game cannot be opened", () => {
        expect(naming({ throws: true })).toBeUndefined();
    });
});
