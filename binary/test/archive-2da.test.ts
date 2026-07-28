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
import { parse2daRowNames } from "../src/archive/two-da";

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
