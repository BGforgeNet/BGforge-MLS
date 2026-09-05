import { describe, expect, it } from "vitest";
import { openGame } from "@bgforge/binary";
import { characterFacetsOf, characterIdFor, type CharacterFacets } from "../src/animation-facets";
import { readIdsCodes } from "../src/ids-tables";
import { miniGame } from "./ie-game-fixtures";

const EE_GAME = process.env.BGFORGE_IE_GAME;

/**
 * The same facets, read out of the IDS comment instead of the id.
 *
 * Test-only, deliberately: the comment is prose the product must not branch on, but it is evidence
 * produced independently of the bitfield, which is exactly what a guard on the bitfield needs. Compared as
 * VALUES, never by substring - "MALE" is a substring of "FEMALE", so a containment check would pass an
 * all-male decode on every female row.
 */
function facetsFromComment(comment: string): CharacterFacets | undefined {
    const words = comment
        .toUpperCase()
        .replace(/^CGAMEANIMATIONTYPE_/, "")
        .replace(/_LOW$/, "")
        .split("_");
    const [charClass, gender, ...rest] = words;
    const race = rest.join("");
    const classes: Record<string, CharacterFacets["charClass"]> = {
        CLERIC: "cleric",
        FIGHTER: "fighter",
        MAGE: "mage",
        THIEF: "thief",
        MONK: "monk",
    };
    const races: Record<string, CharacterFacets["race"]> = {
        HUMAN: "human",
        ELF: "elf",
        DWARF: "dwarf",
        HALFLING: "halfling",
        GNOME: "gnome",
        HALFORC: "halforc",
    };
    if (charClass === undefined || classes[charClass] === undefined) return undefined;
    if (gender !== "MALE" && gender !== "FEMALE") return undefined;
    if (races[race] === undefined) return undefined;
    return { charClass: classes[charClass]!, gender: gender === "MALE" ? "male" : "female", race: races[race]! };
}

describe("characterFacetsOf", () => {
    it("decodes race, gender and class from the id's nibbles", () => {
        expect(characterFacetsOf(0x5211)).toEqual({ race: "elf", gender: "female", charClass: "mage" });
        expect(characterFacetsOf(0x6005)).toEqual({ race: "halforc", gender: "male", charClass: "cleric" });
    });

    it("covers the second generation's full width, which runs past x13", () => {
        // Gnome and half-orc exist only here, so a range stopping at x13 drops them - including 0x6004,
        // the aliasing set the index's own worked example uses.
        expect(characterFacetsOf(0x6004)).toEqual({ race: "gnome", gender: "male", charClass: "cleric" });
        expect(characterFacetsOf(0x6315)).toEqual({ race: "halforc", gender: "female", charClass: "thief" });
    });

    it("decodes monk, whose class nibble is not adjacent to the others", () => {
        expect(characterFacetsOf(0x6500)).toEqual({ race: "human", gender: "male", charClass: "monk" });
        expect(characterFacetsOf(0x6510)).toEqual({ race: "human", gender: "female", charClass: "monk" });
    });

    it("has no facets for the individuals block, whose class nibble is not a class", () => {
        expect(characterFacetsOf(0x6402)).toBeUndefined(); // named MONK, but not the monk class
        expect(characterFacetsOf(0x6400)).toBeUndefined();
    });

    it("has no facets for a monster id or an out-of-range nibble", () => {
        expect(characterFacetsOf(0x1000)).toBeUndefined();
        expect(characterFacetsOf(0x6621)).toBeUndefined(); // class nibble 6 is not a class
        expect(characterFacetsOf(0x6006)).toBeUndefined(); // race nibble 6 is not a race
    });

    it("round-trips an id through its facets", () => {
        for (const id of [0x5211, 0x6005, 0x6315, 0x6510]) {
            const facets = characterFacetsOf(id);
            expect(facets, `0x${id.toString(16)}`).toBeDefined();
            expect(characterIdFor(facets!, id & 0xf000)).toBe(id);
        }
    });
});

/** Rows of an ANISND table whose comment names a class, a gender and a race. */
function facetRows(bytes: Uint8Array): { id: number; comment: string }[] {
    const rows: { id: number; comment: string }[] = [];
    for (const line of new TextDecoder("latin1").decode(bytes).split(/\r?\n/)) {
        const match = /^\s*(0x[0-9a-fA-F]+)\s+\S+\s+(\S+)/.exec(line);
        if (match === null) continue;
        const id = Number.parseInt(match[1]!, 16);
        if (facetsFromComment(match[2]!) !== undefined) rows.push({ id, comment: match[2]! });
    }
    return rows;
}

describe("the decode against a table's own comments", () => {
    it("agrees on every row of the fixture install", () => {
        const rows = facetRows(miniGame().read("ANISND", "ids"));
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(characterFacetsOf(row.id), `0x${row.id.toString(16)}`).toEqual(facetsFromComment(row.comment));
        }
    });
});

describe.skipIf(EE_GAME === undefined)("the decode against a real install's table", () => {
    /**
     * An id its own table names more than once cannot be judged this way.
     *
     * A classic install aliases: `0x6313` is `THIEF_FEMALE_HALFLING`, and the same id again as
     * `THIEF_FEMALE_GNOME` and `THIEF_FEMALE_HALFORC` - so whatever the decode answers, two of the three
     * comments disagree with it. Excluded rather than judged, and COUNTED, so a decode that stopped
     * matching cannot hide behind a shrinking population.
     */
    it("agrees on every row whose comment names a class, gender and race", () => {
        const game = openGame(EE_GAME!);
        expect(game, `no game at ${EE_GAME}`).toBeDefined();
        const rows = facetRows(game!.read("ANISND", "ids"));
        const perId = new Map<number, number>();
        for (const row of rows) perId.set(row.id, (perId.get(row.id) ?? 0) + 1);
        const judged = rows.filter((row) => perId.get(row.id) === 1);
        // Canonical strings, not JSON: `JSON.stringify` is order-sensitive, so two objects carrying the
        // same facets in a different key order compare unequal and every row "disagrees".
        const canonical = (facets: CharacterFacets | undefined): string =>
            facets === undefined ? "none" : `${facets.race}/${facets.gender}/${facets.charClass}`;
        // Reported beside the verdict: a decode that silently stopped matching rows would otherwise pass.
        const disagreed = judged.filter(
            (row) => canonical(characterFacetsOf(row.id)) !== canonical(facetsFromComment(row.comment)),
        );

        expect({ judged: judged.length, aliased: rows.length - judged.length, disagreed }).toEqual({
            judged: judged.length,
            aliased: rows.length - judged.length,
            disagreed: [],
        });
        expect(judged.length).toBeGreaterThan(50);
    });
});

describe("readIdsCodes over the fixture", () => {
    it("still reads the table the facet rows come from", () => {
        expect(readIdsCodes(miniGame().read("ANISND", "ids")).get(0x6500)).toBe("CHMM");
    });
});
