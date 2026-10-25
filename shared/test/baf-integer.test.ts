import { describe, expect, it } from "vitest";
import { bafIntegerValue, bafQuotedIntegerValue } from "../baf-integer";

describe("bafIntegerValue", () => {
    it("reads decimal and hex, signed or not", () => {
        expect(bafIntegerValue("42")).toBe(42);
        expect(bafIntegerValue("-5")).toBe(-5);
        expect(bafIntegerValue("0x10")).toBe(16);
        expect(bafIntegerValue("-0x10")).toBe(-16);
    });

    it("reads a hash prefix, with or without spaces after it", () => {
        expect(bafIntegerValue("#5")).toBe(5);
        expect(bafIntegerValue("# \t5")).toBe(5);
    });

    it("is not a number for text that is not one", () => {
        expect(bafIntegerValue("%n%")).toBeNaN();
    });
});

describe("bafQuotedIntegerValue", () => {
    it("reads the host language's integer forms, as the reference does", () => {
        expect(bafQuotedIntegerValue("3")).toBe(3);
        expect(bafQuotedIntegerValue("-3")).toBe(-3);
        expect(bafQuotedIntegerValue("+3")).toBe(3);
        expect(bafQuotedIntegerValue("0xFF")).toBe(255);
        expect(bafQuotedIntegerValue("0XFF")).toBe(255);
        expect(bafQuotedIntegerValue("-0x10")).toBe(-16);
        expect(bafQuotedIntegerValue("0o17")).toBe(15);
        expect(bafQuotedIntegerValue("0b11")).toBe(3);
        expect(bafQuotedIntegerValue("0u5")).toBe(5);
        expect(bafQuotedIntegerValue("1_0")).toBe(10);
    });

    it("is not a number for anything else, spaces and a hash included", () => {
        for (const text of ["", " 3", "3 ", "#5", "abc", "0x", "0xG", "_1", "0b2"]) {
            expect(bafQuotedIntegerValue(text), text).toBeNaN();
        }
    });
});
