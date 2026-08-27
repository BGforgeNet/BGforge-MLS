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
        const raw = new TextEncoder().encode('{"version":2,"externalPalette":"yes","main":0}\n');

        expect(() => decodeBackup(raw)).toThrow(/externalPalette flag/);
    });

    it("round-trips PVRZ pages alongside the payload, keyed by page number", () => {
        // A BAM v2's frames live outside the .bam, so a backup that dropped the pages would restore
        // to whatever happens to be on disk - the pre-edit picture, or nothing.
        const pages = [
            { page: 4200, bytes: Uint8Array.from([1, 2, 3]) },
            { page: 4201, bytes: Uint8Array.from([4, 5]) },
        ];

        const decoded = decodeBackup(encodeBackup({ bytes: PAYLOAD, externalPalette: false, pages }));

        expect([...decoded.bytes]).toEqual([...PAYLOAD]);
        expect(decoded.pages?.map((p) => p.page)).toEqual([4200, 4201]);
        expect(decoded.pages?.map((p) => [...p.bytes])).toEqual([
            [1, 2, 3],
            [4, 5],
        ]);
    });

    it("round-trips a page whose bytes contain the header terminator", () => {
        // The page table's lengths are what slice the payload; a newline inside a compressed page is
        // ordinary, and cutting on it would corrupt every page after the first.
        const pages = [{ page: 7, bytes: Uint8Array.from([0x0a, 0x0a, 0x42]) }];

        const decoded = decodeBackup(encodeBackup({ bytes: PAYLOAD, externalPalette: false, pages }));

        expect([...(decoded.pages?.[0]?.bytes ?? [])]).toEqual([0x0a, 0x0a, 0x42]);
    });

    it("rejects a header whose page table is not a list of page/length pairs", () => {
        const raw = new TextEncoder().encode('{"version":2,"externalPalette":true,"main":0,"pages":[{"page":1}]}\n');

        expect(() => decodeBackup(raw)).toThrow(/malformed page table/);
    });

    it("rejects a file too short for the lengths its header declares", () => {
        // Truncation must fail here rather than hand back a short final page that decodes as a
        // corrupt texture somewhere far from the cause.
        const raw = new TextEncoder().encode(
            '{"version":2,"externalPalette":true,"main":2,"pages":[{"page":1,"length":8}]}\nAB',
        );

        expect(() => decodeBackup(raw)).toThrow(/truncated/);
    });
});
