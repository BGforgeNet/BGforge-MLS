/**
 * ITM kit-usability bit -> install kits.
 *
 * The fixture is a KITLIST.2DA shaped on the real thing (an installed game is not available to the suite), and
 * its rows are the ones that make the mapping non-trivial: a plain single-bit kit, the eight-way shared
 * `0x00004000` bit the Enhanced Editions pile their extra kits onto, a duplicate row for one kit, and
 * Blackguard's two-bit mask. Column ORDER matters as much as content - the reader addresses cells by the
 * header's column index, so a shifted fixture would pass while reading the wrong column.
 */
import { describe, expect, it } from "vitest";
import type { TwoDaTable } from "@bgforge/binary";
import { kitMaskFor, kitNamesByBit, kitsByUsabilityMask } from "../src/ie-resources/kit-usability";

const STRINGS: Record<number, string> = {
    25151: "Berserker",
    25349: "Priest of Lathander",
    31971: "Shadowdancer",
    31974: "Dwarven Defender",
    28605: "Blackguard",
};
const strref = (id: number): string | undefined => STRINGS[id];

// ROWNAME LOWER MIXED UNUSABLE - the row's own name is separate from its cells, as parse2daTable returns it.
const KITLIST: TwoDaTable = {
    columns: ["ROWNAME", "LOWER", "MIXED", "UNUSABLE"],
    rows: [
        { name: "0", cells: ["RESERVE", "*", "*", "*"] },
        { name: "1", cells: ["BERSERKER", "25179", "25151", "0x00000001"] },
        { name: "21", cells: ["LATHANDER", "24256", "25349", "0x04000000"] },
        { name: "32", cells: ["Blackguard", "28604", "28605", "0x00000021"] },
        { name: "33", cells: ["SHADOWDANCER", "31970", "31971", "0x00004000"] },
        { name: "34", cells: ["DWARVEN_DEFENDER", "31973", "31974", "0x00004000"] },
        // The install's duplicate row for a kit it already lists - same display name, not a second kit.
        { name: "39", cells: ["FAKIE", "24256", "25349", "0x04000000"] },
        // No MIXED string: a mod kit still names itself from its identifier.
        { name: "40", cells: ["OHTEMPUS", "32761", "32762", "0x00004000"] },
    ],
};

describe("kitMaskFor", () => {
    // Byte 1 is the HIGH quarter. Getting this backwards names another quarter's kits with nothing to catch it.
    it("widens a bit to its place in the 32-bit mask, byte 1 highest", () => {
        expect(kitMaskFor(1, 0x40)).toBe(0x40000000);
        expect(kitMaskFor(2, 0x01)).toBe(0x00010000);
        expect(kitMaskFor(3, 0x40)).toBe(0x00004000);
        expect(kitMaskFor(4, 0x01)).toBe(0x00000001);
    });

    // A left shift is signed, so byte 1's top bit would come out negative and match nothing the table parses.
    // This is the one bit where an otherwise-working implementation silently drops a kit (Wild Mage).
    it("keeps byte 1's top bit positive", () => {
        expect(kitMaskFor(1, 0x80)).toBe(0x80000000);
    });
});

describe("kitsByUsabilityMask", () => {
    it("collects every kit that shares a mask", () => {
        const byMask = kitsByUsabilityMask(KITLIST, strref);

        expect(byMask.get(0x00004000)).toEqual(["Shadowdancer", "Dwarven Defender", "OHTEMPUS"]);
    });

    it("resolves a kit's display name through its MIXED strref", () => {
        expect(kitsByUsabilityMask(KITLIST, strref).get(0x00000001)).toEqual(["Berserker"]);
    });

    // Two rows for one kit is a duplicate, not two kits on one bit - reporting it twice would read as a clash.
    it("lists a kit once when the install carries two rows for it", () => {
        expect(kitsByUsabilityMask(KITLIST, strref).get(0x04000000)).toEqual(["Priest of Lathander"]);
    });

    it("falls back to the row identifier when the display strref does not resolve", () => {
        expect(kitsByUsabilityMask(KITLIST, strref).get(0x00004000)).toContain("OHTEMPUS");
    });

    it("ignores the reserved row whose mask cell is the table's default marker", () => {
        expect([...kitsByUsabilityMask(KITLIST, strref).values()].flat()).not.toContain("RESERVE");
    });

    it("returns nothing when the table has no UNUSABLE column", () => {
        const table: TwoDaTable = { columns: ["ROWNAME"], rows: [{ name: "1", cells: ["BERSERKER"] }] };

        expect(kitsByUsabilityMask(table, strref).size).toBe(0);
    });
});

describe("kitNamesByBit", () => {
    const byMask = kitsByUsabilityMask(KITLIST, strref);

    it("keys a byte's bits to the kits they cover", () => {
        expect(kitNamesByBit(byMask, 3)).toEqual({
            "64": ["Shadowdancer", "Dwarven Defender", "OHTEMPUS"],
        });
    });

    it("reports a bit in the byte that actually holds it, and not in the others", () => {
        expect(kitNamesByBit(byMask, 4)).toEqual({ "1": ["Berserker"] });
        expect(kitNamesByBit(byMask, 1)).toEqual({ "4": ["Priest of Lathander"] });
        expect(kitNamesByBit(byMask, 2)).toEqual({});
    });

    // Blackguard's 0x21 is two bits at once, so no single checkbox excludes it. Attributing it to either bit
    // alone would state something the record does not say.
    it("leaves a multi-bit kit out of every single-bit entry", () => {
        const named = Object.values(kitNamesByBit(byMask, 4)).flat();

        expect(named).not.toContain("Blackguard");
    });
});
