/**
 * Unit tests for opaque-range.ts.
 * Covers error branches in decodeOpaqueRange: odd-length chunk, overflow, invalid hex, size mismatch.
 */

import { describe, expect, it } from "vitest";
import { encodeOpaqueRange, decodeOpaqueRange } from "../src/parsers/opaque-range";
import type { ParseOpaqueRange } from "../src/parsers/types";

describe("encodeOpaqueRange", () => {
    it("returns undefined when offset >= end", () => {
        // Line 11-13: offset >= end branch
        const data = new Uint8Array([1, 2, 3]);
        expect(encodeOpaqueRange("label", data, 3)).toBeUndefined();
        expect(encodeOpaqueRange("label", data, 5)).toBeUndefined();
    });

    it("encodes a small range into a single chunk", () => {
        const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
        const result = encodeOpaqueRange("test", data, 0, 4);
        expect(result).toBeDefined();
        expect(result!.label).toBe("test");
        expect(result!.offset).toBe(0);
        expect(result!.size).toBe(4);
        expect(result!.hexChunks).toHaveLength(1);
        expect(result!.hexChunks[0]).toBe("deadbeef");
    });

    it("splits large ranges into multiple chunks", () => {
        // 32 bytes per chunk; 65 bytes should produce 3 chunks
        const data = new Uint8Array(65).fill(0xab);
        const result = encodeOpaqueRange("big", data, 0);
        expect(result).toBeDefined();
        expect(result!.hexChunks).toHaveLength(3);
    });

    it("encodes a sub-range (offset and custom end)", () => {
        const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
        const result = encodeOpaqueRange("sub", data, 1, 3);
        expect(result).toBeDefined();
        expect(result!.offset).toBe(1);
        expect(result!.size).toBe(2);
        expect(result!.hexChunks[0]).toBe("0102");
    });
});

describe("decodeOpaqueRange", () => {
    it("round-trips an encoded range", () => {
        const original = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
        const encoded = encodeOpaqueRange("rt", original, 0)!;
        const decoded = decodeOpaqueRange(encoded);
        expect(decoded).toEqual(original);
    });

    it("throws for odd-length hex chunk", () => {
        // Line 34-36: odd-length hex chunk
        const range: ParseOpaqueRange = {
            label: "bad",
            offset: 0,
            size: 1,
            hexChunks: ["0"],
        };
        expect(() => decodeOpaqueRange(range)).toThrow(/odd-length hex chunk/);
    });

    it("throws when hex data exceeds declared size", () => {
        // Line 39-41: writeOffset >= bytes.length
        const range: ParseOpaqueRange = {
            label: "overflow",
            offset: 0,
            size: 1, // only 1 byte allocated
            hexChunks: ["0000ff"], // 3 bytes of data
        };
        expect(() => decodeOpaqueRange(range)).toThrow(/exceeds declared size/);
    });

    it("throws for invalid hex data (NaN byte)", () => {
        // Line 44-46: Number.isNaN(byte)
        const range: ParseOpaqueRange = {
            label: "badhex",
            offset: 0,
            size: 1,
            hexChunks: ["ZZ"],
        };
        expect(() => decodeOpaqueRange(range)).toThrow(/invalid hex data/);
    });

    it("throws for size mismatch (hex data shorter than declared size)", () => {
        // Line 52-54: writeOffset !== bytes.length
        const range: ParseOpaqueRange = {
            label: "short",
            offset: 0,
            size: 4, // expects 4 bytes
            hexChunks: ["1234"], // only 2 bytes
        };
        expect(() => decodeOpaqueRange(range)).toThrow(/size mismatch/);
    });
});
