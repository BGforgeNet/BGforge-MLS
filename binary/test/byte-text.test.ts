/**
 * The 0x80-0x9F byte range at every byte-to-text site: it is where the two decodings in `byte-text.ts` part
 * ways. A one-byte-per-character field keeps each byte as the code point of the same value; codepage text reads
 * the windows-1252 characters there.
 */

import { describe, expect, it } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { decodeByteString, decodeWindows1252 } from "../src/byte-text";
import { decodeTextResource } from "../src/archive/text-resource";
import { parseIds } from "../src/archive/ids";
import { parseKey } from "../src/archive/key";
import { parseTlk } from "../src/archive/tlk";
import { buildDlg, readDlg } from "../src/dlg";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { charsSpec } from "../src/spec/types";

const HIGH_BYTES = Uint8Array.from({ length: 32 }, (_, i) => 0x80 + i);
const AS_CODE_POINTS = String.fromCodePoint(...HIGH_BYTES);
// windows-1252 for 0x80-0x9F; the five bytes the codepage leaves undefined decode to the C1 code point.
const AS_WINDOWS_1252 = String.fromCodePoint(
    0x20ac,
    0x81,
    0x201a,
    0x192,
    0x201e,
    0x2026,
    0x2020,
    0x2021,
    0x2c6,
    0x2030,
    0x160,
    0x2039,
    0x152,
    0x8d,
    0x17d,
    0x8f,
    0x90,
    0x2018,
    0x2019,
    0x201c,
    0x201d,
    0x2022,
    0x2013,
    0x2014,
    0x2dc,
    0x2122,
    0x161,
    0x203a,
    0x153,
    0x9d,
    0x17e,
    0x178,
);

function ascii(text: string): number[] {
    return [...text].map((c) => c.codePointAt(0)!);
}

describe("byte-text decoders", () => {
    it("decodeByteString keeps each byte as the code point of its value", () => {
        expect(decodeByteString(HIGH_BYTES)).toBe(AS_CODE_POINTS);
        expect(decodeByteString(HIGH_BYTES, 1, 3)).toBe(String.fromCodePoint(0x81, 0x82));
    });

    it("decodeWindows1252 reads the codepage's characters", () => {
        expect(decodeWindows1252(HIGH_BYTES)).toBe(AS_WINDOWS_1252);
    });
});

describe("0x80-0x9F at each decoding site", () => {
    it("IDS and 2DA text resources are windows-1252", () => {
        expect(decodeTextResource(HIGH_BYTES)).toBe(AS_WINDOWS_1252);
        const ids = Uint8Array.from([...ascii("IDS V1.0\r\n1\r\n5 X"), ...HIGH_BYTES, ...ascii("\r\n")]);
        expect(parseIds(ids).get(5)).toBe(`X${AS_WINDOWS_1252}`);
    });

    it("TLK strings with no encoding given fall back to windows-1252 when they are not UTF-8", () => {
        const header = 18;
        const entry = 26;
        const bytes = new Uint8Array(header + entry + HIGH_BYTES.length);
        const view = new DataView(bytes.buffer);
        bytes.set(ascii("TLK V1  "), 0);
        view.setUint32(10, 1, true); // string count
        view.setUint32(14, header + entry, true); // strings offset
        view.setUint16(header, 1, true); // flags: has text
        view.setUint32(header + 22, HIGH_BYTES.length, true); // string length (offset 0)
        bytes.set(HIGH_BYTES, header + entry);
        expect(parseTlk(bytes).get(0)).toBe(AS_WINDOWS_1252);
    });

    it("KEY BIF names and resrefs keep one character per byte", () => {
        const name = [...ascii("data/"), ...HIGH_BYTES, 0];
        const bifOffset = 24;
        const resOffset = bifOffset + 12;
        const nameOffset = resOffset + 14;
        const bytes = new Uint8Array(nameOffset + name.length);
        const view = new DataView(bytes.buffer);
        bytes.set(ascii("KEY V1  "), 0);
        view.setUint32(8, 1, true); // BIF count
        view.setUint32(12, 1, true); // resource count
        view.setUint32(16, bifOffset, true);
        view.setUint32(20, resOffset, true);
        view.setUint32(bifOffset + 4, nameOffset, true);
        view.setUint16(bifOffset + 8, name.length, true);
        bytes.set([0x41, 0x80, 0x9f], resOffset); // resref, NUL-padded to 8
        bytes.set(name, nameOffset);

        const key = parseKey(bytes);
        expect(key.bifs[0]!.name).toBe(`data/${AS_CODE_POINTS}`);
        expect(key.resources[0]!.resref).toBe(String.fromCodePoint(0x41, 0x80, 0x9f));
    });

    it("DLG trigger and action text keeps one character per byte", () => {
        const bytes = buildDlg({
            states: [],
            transitions: [],
            stateTriggers: [],
            transitionTriggers: [],
            actions: [AS_CODE_POINTS],
        });
        // Strings are appended in table order, so the one action is the last bytes of the file.
        expect([...bytes.subarray(bytes.length - HIGH_BYTES.length)]).toEqual([...HIGH_BYTES]);
        expect(readDlg(bytes).actions).toEqual([AS_CODE_POINTS]);
    });

    it("chars fields keep one character per byte and write the same bytes back", () => {
        const codec = toTypedBinarySchema({ text: charsSpec(HIGH_BYTES.length) });
        const read = codec.read(new BufferReader(new Uint8Array(HIGH_BYTES).buffer));
        expect(read).toEqual({ text: AS_CODE_POINTS });

        const out = new ArrayBuffer(HIGH_BYTES.length);
        codec.write(new BufferWriter(out), read);
        expect([...new Uint8Array(out)]).toEqual([...HIGH_BYTES]);
    });
});
