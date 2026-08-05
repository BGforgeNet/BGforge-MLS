/**
 * 2DA row-name reader. Fixtures are built byte-accurately here (an installed game is not available to the test
 * suite), following the layout IESDP documents: a `2DA V1.0` signature line, a default value, a column-header
 * line, then one row per line whose FIRST token is the row name. Real files are tab- and space-aligned and may
 * be XOR-encrypted behind the same 0xFFFF marker as IDS.
 *
 * Row NAME by row INDEX is what the naming use case needs: a field storing a magic school holds the row's
 * position, and MSCHOOL.2DA's row names (ABJURER, CONJURER) are the identifiers. The columns carry other data
 * (a strref, sounds) that no field maps to, so they are not read.
 */
import { describe, it, expect } from "vitest";
import { parse2daRowNames, parse2daTable } from "../src/archive/two-da";

function bytes(body: string): Uint8Array {
    return new TextEncoder().encode(body);
}

// The IE text-encryption key, verbatim from IESDP encryption.htm - declared in the TEST so the fixture is built
// from the published key rather than from whatever the implementation happens to use.
const IE_XOR_KEY = Uint8Array.from([
    0x88, 0xa8, 0x8f, 0xba, 0x8a, 0xd3, 0xb9, 0xf5, 0xed, 0xb1, 0xcf, 0xea, 0xaa, 0xe4, 0xb5, 0xfb, 0xeb, 0x82, 0xf9,
    0x90, 0xca, 0xc9, 0xb5, 0xe7, 0xdc, 0x8e, 0xb7, 0xac, 0xee, 0xf7, 0xe0, 0xca, 0x8e, 0xea, 0xca, 0x80, 0xce, 0xc5,
    0xad, 0xb7, 0xc4, 0xd0, 0x84, 0x93, 0xd5, 0xf0, 0xeb, 0xc8, 0xb4, 0x9d, 0xcc, 0xaf, 0xa5, 0x95, 0xba, 0x99, 0x87,
    0xd2, 0x9d, 0xe3, 0x91, 0xba, 0x90, 0xca,
]);

const MSCHOOL =
    "2DA V1.0\r\n4294967296\r\n            RES_REF\r\nNone\t4294967296\r\nABJURER     8933\r\nCONJURER\t8935\r\n";

describe("parse2daRowNames", () => {
    it("maps each row's index to its name", () => {
        const rows = parse2daRowNames(bytes(MSCHOOL));

        expect([...rows.entries()]).toEqual([
            [0, "None"],
            [1, "ABJURER"],
            [2, "CONJURER"],
        ]);
    });

    // The three header lines carry no row: mistaking any of them for one shifts every index by that many, which
    // would silently rename every value rather than fail.
    it("skips the signature, default-value and column-header lines", () => {
        const rows = parse2daRowNames(bytes(MSCHOOL));

        expect(rows.get(0)).toBe("None");
        expect([...rows.values()]).not.toContain("2DA");
        expect([...rows.values()]).not.toContain("RES_REF");
    });

    // Same 64-byte cyclic XOR as IDS (IESDP encryption.htm); a reader that skips it gets binary noise.
    it("decrypts a file behind the 0xFFFF marker", () => {
        const body = bytes(MSCHOOL);
        const encrypted = new Uint8Array(2 + body.length);
        encrypted[0] = 0xff;
        encrypted[1] = 0xff;
        for (const [i, byte] of body.entries()) encrypted[2 + i] = byte ^ IE_XOR_KEY[i % IE_XOR_KEY.length]!;

        expect(parse2daRowNames(encrypted).get(1)).toBe("ABJURER");
    });

    // Real files align columns with a mix of tabs and runs of spaces.
    it("reads a row whose name is separated by tabs or padded with spaces", () => {
        const rows = parse2daRowNames(
            bytes("2DA V1.0\r\n0\r\n     COL\r\nDIVINER\t\t8937\r\nENCHANTER      18863\r\n"),
        );

        expect([...rows.values()]).toEqual(["DIVINER", "ENCHANTER"]);
    });

    // A blank line must not consume an index - every row after it would otherwise be named one value too high.
    it("does not let a blank line take an index", () => {
        const rows = parse2daRowNames(bytes("2DA V1.0\r\n0\r\n   COL\r\nNone\t0\r\n\r\nABJURER\t1\r\n"));

        expect([...rows.entries()]).toEqual([
            [0, "None"],
            [1, "ABJURER"],
        ]);
    });

    it("returns an empty table for a file with headers but no rows", () => {
        expect(parse2daRowNames(bytes("2DA V1.0\r\n0\r\n   COL\r\n")).size).toBe(0);
    });
});

/**
 * Column-aware reading, for the tables whose DATA a consumer needs rather than only their row names. Shaped on
 * KITLIST.2DA, whose `UNUSABLE` column holds the ITM kit-usability mask and whose `MIXED` column holds the
 * strref of the kit's display name (IESDP kitlist.htm). Cell alignment is the whole point: the header names the
 * data columns only, so a row's first token is its NAME and the rest align to `columns` one-for-one - reading
 * the row name as a data cell shifts every column by one and silently returns a neighbour's value.
 */
const KITLIST =
    "2DA V1.0\r\n*\r\n           ROWNAME    LOWER  MIXED  UNUSABLE    CLASS\r\n" +
    "0          RESERVE    *      *      *           *\r\n" +
    "1          BERSERKER\t25179  25151  0x00000001  2\r\n" +
    "33         SHADOWDANCER 31970 31971 0x00004000  4\r\n";

describe("parse2daTable", () => {
    it("aligns each row's cells to the column names, with the row name kept separate", () => {
        const table = parse2daTable(bytes(KITLIST));

        expect(table.columns).toEqual(["ROWNAME", "LOWER", "MIXED", "UNUSABLE", "CLASS"]);
        expect(table.rows.map((r) => r.name)).toEqual(["0", "1", "33"]);
        expect(table.rows[1]).toEqual({
            name: "1",
            cells: ["BERSERKER", "25179", "25151", "0x00000001", "2"],
        });
    });

    // The reason this reader exists: a consumer looks a column up by NAME, so the index it gets must address the
    // right cell. Off-by-one here would read CLASS as the usability mask on every row.
    it("addresses a named column's cell by its position in the header", () => {
        const table = parse2daTable(bytes(KITLIST));
        const unusable = table.columns.indexOf("UNUSABLE");

        expect(table.rows.map((r) => r.cells[unusable])).toEqual(["*", "0x00000001", "0x00004000"]);
    });

    it("skips the three header lines and blank lines", () => {
        const table = parse2daTable(bytes("2DA V1.0\r\n0\r\n   A  B\r\nr1\t1  2\r\n\r\nr2\t3  4\r\n"));

        expect(table.rows).toEqual([
            { name: "r1", cells: ["1", "2"] },
            { name: "r2", cells: ["3", "4"] },
        ]);
    });

    it("decrypts a file behind the 0xFFFF marker", () => {
        const body = bytes(KITLIST);
        const encrypted = new Uint8Array(2 + body.length);
        encrypted[0] = 0xff;
        encrypted[1] = 0xff;
        for (const [i, byte] of body.entries()) encrypted[2 + i] = byte ^ IE_XOR_KEY[i % IE_XOR_KEY.length]!;

        expect(parse2daTable(encrypted).columns).toEqual(["ROWNAME", "LOWER", "MIXED", "UNUSABLE", "CLASS"]);
    });

    it("returns no rows for a file with headers but no data", () => {
        expect(parse2daTable(bytes("2DA V1.0\r\n0\r\n   COL\r\n")).rows).toEqual([]);
    });
});
