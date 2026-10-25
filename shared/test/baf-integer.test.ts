import { describe, expect, it } from "vitest";
import { bafIntegerValue } from "../baf-integer";

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
