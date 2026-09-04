import { describe, it, expect, vi } from "vitest";

// The resolver only reads uri.scheme/query, like the other game lookups.
vi.mock("vscode", () => ({ Uri: { from: (parts: unknown) => parts } }));

// Imported after vi.mock so the mocked vscode is in place.
import { createCreatureIndexResolver } from "../src/ie-resources/creature-index";
import { GAME_RESOURCE_SCHEME } from "../src/ie-resources/uri";

/** A CRE header carrying the fields the index reads; the rest of the record is not looked at. */
function cre(input: { strref: number; animationId: number; colors: readonly number[] }): Uint8Array {
    const bytes = new Uint8Array(0x40);
    const view = new DataView(bytes.buffer);
    bytes.set(new TextEncoder().encode("CRE V1.0"), 0);
    view.setInt32(0x08, input.strref, true);
    view.setUint32(0x28, input.animationId, true);
    for (const [i, c] of input.colors.entries()) view.setUint8(0x2c + i, c);
    return bytes;
}

const ANISND = [
    "IDS",
    "0x5011 CEFC CGAMEANIMATIONTYPE_CLERIC_FEMALE_ELF",
    "0x6100 CHMB SOME_FIGHTER",
    // A second row for an id already listed, and a decimal-looking row: both are ignored.
    "0x6100 CHMC A_LATER_OVERRIDE",
    "6100 NOPE NOT_HEX",
].join("\n");

const LINES: Record<number, string> = { 100: "Agnasia", 200: "Elminster" };

const RECORDS: Record<string, Uint8Array> = {
    "agnasi.cre": cre({ strref: 100, animationId: 0x5011, colors: [27, 56, 50, 85, 58, 31, 4] }),
    "elmin.cre": cre({ strref: 200, animationId: 0x6100, colors: [1, 2, 3, 4, 5, 6, 7] }),
    // Names nothing in the TLK and uses an animation ANISND does not list.
    "nameless.cre": cre({ strref: -1, animationId: 0x9999, colors: [0, 0, 0, 0, 0, 0, 0] }),
};

function gameSource(
    overrides: { missing?: string[]; truncated?: boolean; noAnisnd?: boolean; unreadable?: string[] } = {},
) {
    const resources = Object.keys(RECORDS).filter((n) => !(overrides.missing ?? []).includes(n));
    return {
        gameAt: () => ({
            tlk: () => ({ get: (n: number) => LINES[n] }),
            canRead: (resref: string, type: string) => {
                const name = `${resref}.${type}`.toLowerCase();
                if (name === "anisnd.ids") return overrides.noAnisnd !== true;
                return resources.includes(name);
            },
            read: (resref: string, type: string) => {
                const name = `${resref}.${type}`.toLowerCase();
                if (name === "anisnd.ids") return new TextEncoder().encode(ANISND);
                if ((overrides.unreadable ?? []).includes(name)) throw new Error(`corrupt ${name}`);
                const bytes = RECORDS[name];
                if (!bytes) throw new Error(`no ${name}`);
                return overrides.truncated === true ? bytes.slice(0, 8) : bytes;
            },
            list: () => [
                // The archive lists every resource, not only creatures.
                { resref: "AGNASI", ext: "bam" },
                { resref: "SOMEAREA", ext: undefined },
                ...resources.map((name) => ({
                    resref: name.slice(0, name.lastIndexOf(".")).toUpperCase(),
                    ext: "cre",
                })),
            ],
        }),
    };
}

function gameUri(gameDir = "/games/bgee"): never {
    return { scheme: GAME_RESOURCE_SCHEME, query: `g=${encodeURIComponent(gameDir)}`, path: "/x.bam" } as never;
}

describe("createCreatureIndexResolver", () => {
    it("indexes every creature with its name, animation and seven colours", () => {
        const index = createCreatureIndexResolver(gameSource())(gameUri());

        expect(index?.map((e) => e.resref)).toEqual(["AGNASI", "ELMIN", "NAMELESS"]);
        expect(index?.[0]).toEqual({
            resref: "AGNASI",
            name: "Agnasia",
            animationId: 0x5011,
            animationCode: "CEFC",
            colors: { metal: 27, minor: 56, major: 50, skin: 85, leather: 58, armor: 31, hair: 4 },
        });
    });

    it("names the animation from the install's own table, leaving an unlisted id uncoded", () => {
        const index = createCreatureIndexResolver(gameSource())(gameUri());

        expect(index?.find((e) => e.resref === "ELMIN")?.animationCode).toBe("CHMB");
        expect(index?.find((e) => e.resref === "NAMELESS")?.animationCode).toBe("");
    });

    it("keeps a creature the string table cannot name, so it is still pickable by resref", () => {
        const index = createCreatureIndexResolver(gameSource())(gameUri());

        expect(index?.find((e) => e.resref === "NAMELESS")?.name).toBe("");
    });

    it("indexes the creatures even when the install ships no animation table", () => {
        const index = createCreatureIndexResolver(gameSource({ noAnisnd: true }))(gameUri());

        expect(index).toHaveLength(3);
        expect(index?.every((e) => e.animationCode === "")).toBe(true);
    });

    it("skips a record too short to hold the header rather than reading past it", () => {
        const index = createCreatureIndexResolver(gameSource({ truncated: true }))(gameUri());

        expect(index).toEqual([]);
    });

    // An install with one damaged record still has thousands of good ones; losing the whole picker over it
    // would be the worse failure.
    it("keeps indexing past a record the archive cannot read", () => {
        const index = createCreatureIndexResolver(gameSource({ unreadable: ["elmin.cre"] }))(gameUri());

        expect(index?.map((e) => e.resref)).toEqual(["AGNASI", "NAMELESS"]);
    });

    it("indexes only the creature resources the archive lists", () => {
        const index = createCreatureIndexResolver(gameSource())(gameUri());

        expect(index?.map((e) => e.resref)).toEqual(["AGNASI", "ELMIN", "NAMELESS"]);
    });

    // Same posture as the other game lookups: an install nothing can be read out of is "no creatures", and
    // the failed attempt is remembered so the dropdown does not re-probe it on every keystroke.
    it("treats an unreadable game as no creatures, without re-probing it", () => {
        let asked = 0;
        const failing = {
            gameAt: () => {
                asked += 1;
                throw new Error("unreadable");
            },
        };
        const resolve = createCreatureIndexResolver(failing);

        expect(resolve(gameUri())).toBeUndefined();
        expect(resolve(gameUri())).toBeUndefined();
        expect(asked).toBe(1);
    });

    it("resolves nothing for a document outside a game", () => {
        const fileUri = { scheme: "file", query: "", path: "/mods/x.bam" } as never;

        expect(createCreatureIndexResolver(gameSource())(fileUri)).toBeUndefined();
    });

    // Thousands of records per install, and both the dropdown and its search ask repeatedly.
    it("builds the index once and hands back the same one", () => {
        const resolve = createCreatureIndexResolver(gameSource());

        const first = resolve(gameUri());

        expect(resolve(gameUri())).toBe(first);
    });
});
