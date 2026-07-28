import { describe, it, expect, vi } from "vitest";

// The resolver only reads uri.scheme/query, so mock vscode.Uri as the parts holder (same shape as the
// ie-resources-uri test) rather than pulling in vscode.Uri internals.
vi.mock("vscode", () => ({ Uri: { from: (parts: unknown) => parts } }));

// Imported after vi.mock so the mocked vscode is in place.
import {
    createNamingTableResolver,
    createResourceTypeResolver,
    createSlotLabelResolver,
    createStrrefResolver,
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
    overrides: { throws?: boolean; noTlk?: boolean; tables?: string[]; twoDa?: string[]; resources?: string[] } = {},
): {
    ensureOpen: (dir: string) => {
        tlk: () => { get: (n: number) => string | undefined } | undefined;
        ids: (resref: string) => ReadonlyMap<number, string> | undefined;
        twoDa: (resref: string) => ReadonlyMap<number, string> | undefined;
        canRead: (resref: string, type: string) => boolean;
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
            };
        },
    };
}

function gameUri(gameDir = "/games/tob"): never {
    // Cast-free: the resolver reads only these two members off the URI.
    return { scheme: GAME_RESOURCE_SCHEME, query: `g=${encodeURIComponent(gameDir)}`, path: "/sw1h01.itm" } as never;
}

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

        expect(resolve(gameUri(), "ids", ["SNDSLOT"])).toEqual(new Map([[21, "AREA_FOREST"]]));
    });

    // First table PRESENT wins outright - not a per-key merge. Two installs' tables mean different things at
    // the same key, so blending them would invent entries that exist in neither.
    it("returns the first table the game ships, never a blend of both", () => {
        const resolve = createNamingTableResolver(session({ tables: ["sndslot", "soundoff"] }));

        expect(resolve(gameUri(), "ids", ["SNDSLOT", "SOUNDOFF"])).toEqual(new Map([[21, "AREA_FOREST"]]));
    });

    it("falls back to the next table when the preferred one is absent", () => {
        const resolve = createNamingTableResolver(session({ tables: ["soundoff"] }));

        expect(resolve(gameUri(), "ids", ["SNDSLOT", "SOUNDOFF"])?.get(35)).toBe("SELECT_RARE");
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
    // Answers with the TYPE, not a boolean: an edition-dependent field (ITM `replacement` is an item in
    // BG1/BG2/BGEE and a sound in PSTEE) is opened without the caller knowing which edition it is looking at.
    it("answers with the candidate type the install actually ships", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }));

        expect(resolve(gameUri(), ["ITM", "WAV"], "SW1H01")).toBe("ITM");
    });

    it("falls through to a later candidate when the first is absent", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["drop01.wav"] }));

        expect(resolve(gameUri(), ["ITM", "WAV"], "DROP01")).toBe("WAV");
    });

    // Never judges: a mod record legitimately references what a later install step creates, so an unresolvable
    // resref simply gets no answer - the editor withholds the affordance rather than marking the field.
    it("answers nothing when the install has none of the candidates", () => {
        expect(createResourceTypeResolver(session())(gameUri(), ["ITM"], "NOPE")).toBeUndefined();
    });

    // The "no resource" value must never be probed - every empty resref would otherwise hit the game index.
    it("never probes an empty resref", () => {
        const resolve = createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }));

        expect(resolve(gameUri(), ["ITM"], "")).toBeUndefined();
    });

    it("answers nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "g=%2Fgames%2Ftob", path: "/mods/x.itm" } as never;

        expect(
            createResourceTypeResolver(session({ resources: ["sw1h01.itm"] }))(fileUri, ["ITM"], "SW1H01"),
        ).toBeUndefined();
    });

    // An unreadable game must not fail the open - the field just gets no affordance.
    it("swallows an unopenable game", () => {
        expect(createResourceTypeResolver(session({ throws: true }))(gameUri(), ["ITM"], "SW1H01")).toBeUndefined();
    });
});
