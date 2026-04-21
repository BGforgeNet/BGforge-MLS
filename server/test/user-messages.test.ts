/**
 * Unit tests for user-messages.ts -- URI decoding in user-facing messages.
 */

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { decodeFileUris } from "../src/user-messages";

describe("decodeFileUris", () => {
    it("decodes a percent-encoded file URI to a native path", () => {
        const msg = "Failed: file:///c%3A/Games/%21ecco/file.h";
        const expected = "Failed: " + fileURLToPath("file:///c%3A/Games/%21ecco/file.h");
        expect(decodeFileUris(msg)).toBe(expected);
    });

    it("decodes an already-decoded file URI to a native path", () => {
        const msg = "Failed: file:///c:/Games/!ecco/file.h";
        const expected = "Failed: " + fileURLToPath("file:///c:/Games/!ecco/file.h");
        expect(decodeFileUris(msg)).toBe(expected);
    });

    it("decodes Unix file URIs", () => {
        const msg = "Error in file:///home/user/project/file.h";
        expect(decodeFileUris(msg)).toBe("Error in /home/user/project/file.h");
    });

    it("decodes multiple URIs in the same message", () => {
        const msg = "file:///a/%21b.h and file:///c/d.h";
        const expected = fileURLToPath("file:///a/%21b.h") + " and " + fileURLToPath("file:///c/d.h");
        expect(decodeFileUris(msg)).toBe(expected);
    });

    it("handles URIs with spaces encoded as %20", () => {
        const msg = "file:///home/user/my%20project/file.h";
        const expected = fileURLToPath("file:///home/user/my%20project/file.h");
        expect(decodeFileUris(msg)).toBe(expected);
    });

    it("returns messages without URIs unchanged", () => {
        const msg = "Compiled successfully.";
        expect(decodeFileUris(msg)).toBe(msg);
    });

    it("returns empty string unchanged", () => {
        expect(decodeFileUris("")).toBe("");
    });

    it("does not modify non-file URIs", () => {
        const msg = "See https://example.com/docs for help";
        expect(decodeFileUris(msg)).toBe(msg);
    });

    it("returns malformed file URI unchanged when fileURLToPath throws (catch branch)", () => {
        // A URI like file:///invalid%ZZpath matches the regex but fileURLToPath throws.
        // The catch block returns the original URI unchanged.
        const malformed = "file:///invalid%ZZpath";
        const msg = `See ${malformed} for details`;
        const result = decodeFileUris(msg);
        // The URI should be passed through unchanged since it can't be decoded
        expect(result).toContain(malformed);
    });
});
