import { describe, expect, it } from "vitest";
import { decodeBackup, encodeBackup } from "../../src/image-editor/backup";

// A payload with an embedded newline: the header is delimited by the FIRST 0x0a, so a byte-identical
// round-trip here is what proves the split is not a naive "cut at any newline".
const PAYLOAD = Uint8Array.from([0x42, 0x41, 0x4d, 0x0a, 0x00, 0xff, 0x0a, 0x0a, 0x7f]);

describe("animation editor backup container", () => {
    it("round-trips the payload byte-for-byte with the palette flag set", () => {
        const decoded = decodeBackup(encodeBackup({ bytes: PAYLOAD, externalPalette: true }));

        expect([...decoded.bytes]).toEqual([...PAYLOAD]);
        expect(decoded.externalPalette).toBe(true);
    });

    it("round-trips the palette flag when it is off", () => {
        const decoded = decodeBackup(encodeBackup({ bytes: PAYLOAD, externalPalette: false }));

        expect(decoded.externalPalette).toBe(false);
    });

    it("round-trips an empty payload", () => {
        const decoded = decodeBackup(encodeBackup({ bytes: new Uint8Array(), externalPalette: false }));

        expect(decoded.bytes).toHaveLength(0);
    });

    it("rejects a payload with no header terminator", () => {
        expect(() => decodeBackup(Uint8Array.from([0x42, 0x41, 0x4d]))).toThrow(/missing its header/);
    });

    it("rejects a header written by an unsupported container version", () => {
        const raw = new TextEncoder().encode('{"version":99,"externalPalette":true}\n');

        expect(() => decodeBackup(raw)).toThrow(/unsupported version 99/);
    });

    it("rejects a header that is not an object", () => {
        expect(() => decodeBackup(new TextEncoder().encode('"nope"\n'))).toThrow(/malformed header/);
    });

    it("rejects a header whose palette flag is not a boolean", () => {
        const raw = new TextEncoder().encode('{"version":1,"externalPalette":"yes"}\n');

        expect(() => decodeBackup(raw)).toThrow(/externalPalette flag/);
    });
});
