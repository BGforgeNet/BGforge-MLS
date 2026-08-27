import { describe, expect, test } from "vitest";
import { type BcsScript, readBcs, writeBcs } from "@bgforge/bcs";

/**
 * The spacing is the whole difficulty here, and it is not uniform: measured across 1.46 million field lines
 * in 4939 real scripts, there are exactly eight shapes, and which one applies depends on the record. An
 * object writes a space before its quoted field and none after it; a trigger writes a space on both sides
 * of both of its own; an action writes none before the first and one after the second. Getting any of them
 * wrong changes every file that contains that record.
 */

const OBJECT = '0 0 0 0 0 0 0 0 0 0 0 0 ""OB';

function script(body: string[]): string {
    return ["SC", "CR", "CO", ...body, "SC", ""].join("\n");
}

const emptyScript: BcsScript = { blocks: [] };

describe("writeBcs - spacing", () => {
    test("writes an object's quoted field after a space, with none before the marker", () => {
        const text = script(["TR", "16412 0OB", OBJECT, "TR", "CO", "RS", "RS", "CR"]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test("writes a trigger's quoted pair with a space on each side", () => {
        const text = script(["TR", '16399 0 0 0 0 "LOCALSx" "" OB', OBJECT, "TR", "CO", "RS", "RS", "CR"]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test("writes an action's quoted pair with no space before the first", () => {
        const text = script([
            "CO",
            "RS",
            "RE",
            "100AC",
            "160OB",
            OBJECT,
            "OB",
            OBJECT,
            "OB",
            OBJECT,
            '3745 0 0 0 0"J#Belt12" "CDHLYSYM" AC',
            "RE",
            "RS",
            "CR",
        ]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test("omits the quoted pair entirely where the record carries none", () => {
        // The distinction the reader keeps: a BG1-era record has no quoted fields, and writing a pair of
        // empty ones would add four bytes to every such line.
        const text = script([
            "CO",
            "RS",
            "RE",
            "100AC",
            "29OB",
            OBJECT,
            "OB",
            OBJECT,
            "OB",
            OBJECT,
            "50 0 0 0 69AC",
            "RE",
            "RS",
            "CR",
        ]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });
});

describe("writeBcs - structure", () => {
    test("attaches a response's weight to whatever marker follows it", () => {
        // A response with no actions writes its weight against its own closing marker rather than against
        // an action's opener, which is what `100RE` is. 28 corpus files rely on it.
        const text = script(["CO", "RS", "RE", "100RE", "RS", "CR"]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });

    test("writes a blockless script as its markers, not as an empty file", () => {
        expect(writeBcs(emptyScript)).toBe("SC\nSC\n");
    });

    test("ends the file with a newline after the closing marker", () => {
        const text = script(["CO", "RS", "RS", "CR"]);

        expect(writeBcs(readBcs(text)).endsWith("SC\n")).toBe(true);
    });
});

describe("writeBcs - round trip", () => {
    test("re-emits a script holding every record kind byte for byte", () => {
        const text = script([
            "TR",
            '16399 0 0 0 0 "GLOBALx" "" OB',
            OBJECT,
            "TR",
            "TR",
            "16412 0OB",
            OBJECT,
            "TR",
            "CO",
            "RS",
            "RE",
            "100AC",
            "160OB",
            OBJECT,
            "OB",
            OBJECT,
            "OB",
            OBJECT,
            '3745 0 0 0 0"a" "b" AC',
            "AC",
            "29OB",
            OBJECT,
            "OB",
            OBJECT,
            "OB",
            OBJECT,
            "50 0 0 0 69AC",
            "RE",
            "RE",
            "50RE",
            "RS",
            "CR",
        ]);

        expect(writeBcs(readBcs(text))).toBe(text);
    });
});
