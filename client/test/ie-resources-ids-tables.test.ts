import { describe, expect, it } from "vitest";
import { readIdsCodes } from "../src/ie-resources/ids-tables";

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("readIdsCodes", () => {
    it("reads hex-keyed rows into id -> uppercased code", () => {
        const table = readIdsCodes(bytes("IDS\n0x5000 chmc CLERIC_MALE_HUMAN\n0x1000 MWYV WYVERN\n"));
        expect(table.get(0x5000)).toBe("CHMC");
        expect(table.get(0x1000)).toBe("MWYV");
    });

    it("keeps the first row when an install names one id twice", () => {
        const table = readIdsCodes(bytes("IDS\n0x5000 CHMC first\n0x5000 CHMB second\n"));
        expect(table.get(0x5000)).toBe("CHMC");
    });

    it("ignores rows whose id is not hex", () => {
        expect(readIdsCodes(bytes("IDS\n5000 CHMC\n")).size).toBe(0);
    });

    it("ignores a row with no code", () => {
        expect(readIdsCodes(bytes("IDS\n0x5000\n")).size).toBe(0);
    });
});
