/**
 * IDS lookup-table reader. Fixtures are built byte-accurately here (an installed game is not available to the
 * test suite), following the format IESDP documents: two optional header lines, then `<value> <identifier>`
 * rows in decimal or hex, optionally XOR-encrypted behind an 0xFFFF marker.
 */
import { describe, it, expect } from "vitest";
import { parseIds, parseIdsAll } from "../src/archive/ids";

/** The game writes CRLF and pads identifiers with trailing spaces. */
function idsBytes(body: string): Uint8Array {
    return new TextEncoder().encode(body);
}

// The IE text-encryption key, verbatim from IESDP encryption.htm. Declared in the TEST so the fixture is built
// from the published key rather than from whatever the implementation happens to use.
const IE_XOR_KEY = Uint8Array.from([
    0x88, 0xa8, 0x8f, 0xba, 0x8a, 0xd3, 0xb9, 0xf5, 0xed, 0xb1, 0xcf, 0xea, 0xaa, 0xe4, 0xb5, 0xfb, 0xeb, 0x82, 0xf9,
    0x90, 0xca, 0xc9, 0xb5, 0xe7, 0xdc, 0x8e, 0xb7, 0xac, 0xee, 0xf7, 0xe0, 0xca, 0x8e, 0xea, 0xca, 0x80, 0xce, 0xc5,
    0xad, 0xb7, 0xc4, 0xd0, 0x84, 0x93, 0xd5, 0xf0, 0xeb, 0xc8, 0xb4, 0x9d, 0xcc, 0xaf, 0xa5, 0x95, 0xba, 0x99, 0x87,
    0xd2, 0x9d, 0xe3, 0x91, 0xba, 0x90, 0xca,
]);

describe("parseIds", () => {
    it("maps each value to its identifier", () => {
        const ids = parseIds(idsBytes("IDS V1.0\r\n0 INITIAL_MEETING\r\n1 MORALE\r\n"));

        expect(ids.get(0)).toBe("INITIAL_MEETING");
        expect(ids.get(1)).toBe("MORALE");
    });

    // The 64-byte cyclic XOR IESDP documents (encryption.htm), behind the 0xFFFF marker. BG2 ships SOUNDOFF.IDS
    // in this form, so a reader that skips it gets binary noise rather than a table.
    it("decrypts a file behind the 0xFFFF marker", () => {
        const plain = "IDS V1.0\r\n0 INITIAL_MEETING\r\n1 MORALE\r\n";
        const body = idsBytes(plain);
        const encrypted = new Uint8Array(2 + body.length);
        encrypted[0] = 0xff;
        encrypted[1] = 0xff;
        for (const [i, byte] of body.entries()) encrypted[2 + i] = byte ^ IE_XOR_KEY[i % IE_XOR_KEY.length]!;

        const ids = parseIds(encrypted);

        expect(ids.get(0)).toBe("INITIAL_MEETING");
        expect(ids.get(1)).toBe("MORALE");
    });

    // The real SNDSLOT.IDS pads every identifier out to a fixed column.
    it("drops the trailing padding the game writes", () => {
        const ids = parseIds(idsBytes("IDS V1.0\r\n0 INITIAL_MEETING          \r\n"));

        expect(ids.get(0)).toBe("INITIAL_MEETING");
    });

    // "The IDS file header consists of two lines, either of which may be omitted" (IESDP ids.htm).
    it("reads a file with no header line", () => {
        expect(parseIds(idsBytes("0 MORALE\r\n")).get(0)).toBe("MORALE");
    });

    // The second header line is an entry count, "not always correct" - so it must not be mistaken for a row.
    it("does not mistake the entry-count header for a row", () => {
        const ids = parseIds(idsBytes("IDS V1.0\r\n2\r\n0 INITIAL_MEETING\r\n1 MORALE\r\n"));

        expect(ids.size).toBe(2);
        expect(ids.get(2)).toBeUndefined();
    });

    it("accepts a hex value", () => {
        expect(parseIds(idsBytes("0x0010 BATTLE_CRY1\r\n")).get(16)).toBe("BATTLE_CRY1");
    });

    /**
     * Radix is per FILE, so two tables naming one value space can disagree about it - PROJECTL.IDS is written
     * in hex (`0x0001 ARROW`) and MISSILE.IDS in decimal (`1 None`), and a consumer joins them on the key. The
     * keys must therefore land in ONE numeric space, which is only observable across a PAIR: either file alone
     * reads consistently under a wrong radix for its `0x0001`-`0x0009` rows, and 64 of BG2:ToB's 172 projectl
     * rows carry a letter in the key, so a decimal parse would silently drop exactly those.
     */
    it("folds hex and decimal spellings of one value onto the same key", () => {
        const hexTable = parseIds(idsBytes("0x006B ACIDBLOB\r\n0x000A AXE\r\n"));
        const decimalTable = parseIds(idsBytes("107 Acid_Blob\r\n10 Axe_Heavy\r\n"));

        expect([...hexTable.keys()]).toEqual([...decimalTable.keys()]);
        expect(hexTable.get(107)).toBe("ACIDBLOB");
        expect(decimalTable.get(107)).toBe("Acid_Blob");
    });

    /**
     * The identifier column runs to the end of the line, spaces included. Two shipped tables need this and are
     * read wrongly without it: MISSILE.IDS names projectiles in prose (`3 Arrow Exploding`), and TRIGGER.IDS
     * writes a whole signature whose parameter names carry spaces. Both rows below are verbatim from BG2:ToB.
     *
     * A reader that takes only the first token after the value does not mis-name these - it drops them, which
     * is the worse failure: 250 of MISSILE.IDS's rows and 9 of TRIGGER.IDS's vanish from a table that reports
     * itself as read.
     */
    it("keeps an identifier that contains spaces", () => {
        const missile = parseIds(idsBytes("IDS\r\n2 Arrow\r\n3 Arrow Exploding\r\n"));
        const trigger = parseIds(idsBytes("0x4010 HP(O:Object*,I:Hit Points*)\r\n"));

        expect(missile.get(3)).toBe("Arrow Exploding");
        expect(trigger.get(0x4010)).toBe("HP(O:Object*,I:Hit Points*)");
    });

    /**
     * Real tables name one value twice - BG2:ToB's ACTION.IDS does it 32 times, and CLASS.IDS's 202 is
     * `LONG_BOW` for an item and `MAGE_ALL` for a creature. Position does not rank them: id 160's two rows take
     * different argument types (`ApplySpell(O:Target,I:Spell*Spell)` and `ApplySpellRES(S:RES*,O:Target)`), so
     * only a caller holding the record can say which was meant. Hence both readings - one row per value, and
     * every row for a caller that has to choose.
     */
    it("keeps the last row when a value is named twice, and every row through parseIdsAll", () => {
        const body = "IDS V1.0\r\n8 Dialogue(O:Object*)\r\n8 Dialog(O:Object*)\r\n1 Attack(O:Target*)\r\n";

        expect(parseIds(idsBytes(body)).get(8)).toBe("Dialog(O:Object*)");
        expect(parseIdsAll(idsBytes(body)).get(8)).toEqual(["Dialogue(O:Object*)", "Dialog(O:Object*)"]);
        expect(parseIdsAll(idsBytes(body)).get(1)).toEqual(["Attack(O:Target*)"]);
    });

    it("skips blank and malformed lines rather than failing the table", () => {
        const ids = parseIds(idsBytes("IDS V1.0\r\n\r\n0 MORALE\r\nnonsense\r\n\r\n1 HAPPY\r\n"));

        expect([...ids.entries()]).toEqual([
            [0, "MORALE"],
            [1, "HAPPY"],
        ]);
    });
});
