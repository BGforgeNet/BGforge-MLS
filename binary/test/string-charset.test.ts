import { describe, expect, it } from "vitest";
import { isCharAllowedInCharset, isStringAllowedInCharset } from "../src/string-charset";

describe("isCharAllowedInCharset", () => {
    it("accepts every codepoint under utf8", () => {
        expect(isCharAllowedInCharset(0x00, "utf8")).toBe(true);
        expect(isCharAllowedInCharset(0x7f, "utf8")).toBe(true);
        expect(isCharAllowedInCharset(0xe9, "utf8")).toBe(true); // 'é'
    });

    it("accepts the printable-ASCII range under ascii-printable", () => {
        expect(isCharAllowedInCharset(0x20, "ascii-printable")).toBe(true); // space
        expect(isCharAllowedInCharset(0x41, "ascii-printable")).toBe(true); // A
        expect(isCharAllowedInCharset(0x7e, "ascii-printable")).toBe(true); // ~
    });

    it("rejects control and high codepoints under ascii-printable", () => {
        expect(isCharAllowedInCharset(0x00, "ascii-printable")).toBe(false); // NUL
        expect(isCharAllowedInCharset(0x09, "ascii-printable")).toBe(false); // tab
        expect(isCharAllowedInCharset(0x1f, "ascii-printable")).toBe(false);
        expect(isCharAllowedInCharset(0x7f, "ascii-printable")).toBe(false); // DEL
        expect(isCharAllowedInCharset(0xe9, "ascii-printable")).toBe(false); // 'é'
    });
});

describe("isStringAllowedInCharset", () => {
    it("returns true for any string under utf8", () => {
        expect(isStringAllowedInCharset("café", "utf8")).toBe(true);
        expect(isStringAllowedInCharset("", "utf8")).toBe(true);
    });

    it("returns true only for printable-ASCII strings under ascii-printable", () => {
        expect(isStringAllowedInCharset("HELLO.SAV", "ascii-printable")).toBe(true);
        expect(isStringAllowedInCharset("", "ascii-printable")).toBe(true);
        expect(isStringAllowedInCharset("café", "ascii-printable")).toBe(false);
        expect(isStringAllowedInCharset("a\tb", "ascii-printable")).toBe(false);
    });
});
