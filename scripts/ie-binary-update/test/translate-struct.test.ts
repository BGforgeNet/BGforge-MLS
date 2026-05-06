import { describe, expect, test } from "vitest";
import { translateStruct } from "../src/translate.ts";

describe("translateStruct — empty", () => {
    test("empty input yields no fields and no imports", () => {
        const result = translateStruct([]);
        expect(result.fields).toEqual([]);
        expect([...result.imports].sort()).toEqual([]);
    });
});

describe("translateStruct — multiple fields", () => {
    test("collects fields in order and tracks codec imports", () => {
        const result = translateStruct([
            { type: "byte", id: "a", desc: "A" },
            { type: "word", id: "b", desc: "B" },
            { type: "dword", id: "c", desc: "C" },
        ]);
        expect(result.fields.map((f) => f.name)).toEqual(["a", "b", "c"]);
        expect([...result.imports].sort()).toEqual(["u16", "u32", "u8"]);
    });

    test("array fields collect arraySpec import", () => {
        const result = translateStruct([{ type: "char array", length: 4, id: "signature", desc: "Sig" }]);
        expect([...result.imports].sort()).toEqual(["arraySpec", "u8"]);
    });
});

describe("translateStruct — offset validation", () => {
    test("running offset mismatch throws", () => {
        // First field is byte (1 byte), so the next runs at 0x01.
        // Declaring offset: 0x05 on the second field is a mismatch.
        expect(() =>
            translateStruct([
                { type: "byte", id: "a", desc: "A" },
                { type: "byte", id: "b", desc: "B", offset: 0x05 },
            ]),
        ).toThrow(/offset mismatch/i);
    });

    test("running offset match passes", () => {
        const result = translateStruct([
            { type: "byte", id: "a", desc: "A" },
            { type: "word", id: "b", desc: "B", offset: 0x01 },
        ]);
        expect(result.fields).toHaveLength(2);
    });
});

describe("translateStruct — unused/unknown fields", () => {
    test("unused fields are emitted as padding to keep wire bytes round-trippable", () => {
        const result = translateStruct([
            { type: "byte", id: "a", desc: "A" },
            { type: "byte", desc: "Unknown", unused: 1 },
            { type: "byte", id: "b", desc: "B" },
        ]);
        expect(result.fields.map((f) => f.name)).toEqual(["a", "unused1", "b"]);
    });

    test("multiple unused fields get distinct numbered names", () => {
        const result = translateStruct([
            { type: "byte", desc: "Unknown", unused: 1 },
            { type: "word", desc: "Unknown", unused: 1 },
        ]);
        expect(result.fields.map((f) => f.name)).toEqual(["unused1", "unused2"]);
    });
});
