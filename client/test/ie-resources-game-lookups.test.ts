import { describe, it, expect, vi } from "vitest";

// The resolver only reads uri.scheme/query, so mock vscode.Uri as the parts holder (same shape as the
// ie-resources-uri test) rather than pulling in vscode.Uri internals.
vi.mock("vscode", () => ({ Uri: { from: (parts: unknown) => parts } }));

// Imported after vi.mock so the mocked vscode is in place.
import {
    createNamingTableResolver,
    createResourceListResolver,
    createResourceTypeResolver,
    createSlotLabelResolver,
    createStrrefResolver,
    isGameDocument,
} from "../src/ie-resources/game-lookups";
import { GAME_RESOURCE_SCHEME } from "../src/ie-resources/uri";

const LINES: Record<number, string> = { 6348: "Ring of Protection +1", 72909: "" };

const TABLES: Record<string, ReadonlyMap<number, string>> = {
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
    } = {},
): {
    ensureOpen: (dir: string) => {
        tlk: () => { get: (n: number) => string | undefined } | undefined;
        ids: (resref: string) => ReadonlyMap<number, string> | undefined;
        twoDa: (resref: string) => ReadonlyMap<number, string> | undefined;
        canRead: (resref: string, type: string) => boolean;
        list: () => { resref: string; ext: string | undefined }[];
        identity: { flavour: string };
    };
} {
    return {
        ensureOpen: (dir: string) => {
            if (overrides.throws === true) throw new Error(`no game at ${dir}`);
            return {
                tlk: () => (overrides.noTlk === true ? undefined : { get: (n: number) => LINES[n] }),
                ids: (resref: string) =>
                    (overrides.tables ?? []).includes(resref.toLowerCase()) ? TABLES[resref.toLowerCase()] : undefined,
                twoDa: (resref: string) =>
                    (overrides.twoDa ?? []).includes(resref.toLowerCase()) ? TABLES[resref.toLowerCase()] : undefined,
                canRead: (resref: string, type: string) =>
                    (overrides.resources ?? []).includes(`${resref}.${type}`.toLowerCase()),
                // The install's whole namespace, biffed and override alike - `resources` doubles as it, split
                // back into the resref/ext pair `Game.list()` yields.
                list: () =>
                    (overrides.resources ?? []).map((name) => {
                        const dot = name.lastIndexOf(".");
                        return { resref: name.slice(0, dot).toUpperCase(), ext: name.slice(dot + 1) };
                    }),
                identity: { flavour: overrides.flavour ?? "tob" },
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
                twoDa: () => undefined,
                canRead: () => false,
                list: () => [],
                identity: { flavour: "tob" },
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
