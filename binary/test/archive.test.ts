/**
 * KEY/BIF archive reader tests. There is no real chitin.key/BIF in `external/`
 * (those are mod sources, not game installs), so fixtures are built byte-accurately
 * here - which also lets each compression variant and edge case be exercised precisely.
 */

import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as zlib from "zlib";
import {
    parseKey,
    openBif,
    parseBif,
    parseTlk,
    openTlk,
    openGame,
    detectGameIdentity,
    bufferSource,
    resourceTypeExt,
    resourceTypeCode,
    type ByteSource,
} from "@bgforge/binary";

const RESTYPE_ITM = 0x03ed;
const RESTYPE_SPL = 0x03ee;
const RESTYPE_TIS = 0x03eb;
const RESTYPE_ARE = 0x03f2;
const RESTYPE_IDS = 0x03f0;
const RESTYPE_MVE = 0x0002;
const RESTYPE_2DA = 0x03f4;
const RESTYPE_WAV = 0x0004;

function writeStr(dv: DataView, offset: number, s: string): void {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.codePointAt(i)!);
}

/** Materialize bytes for order-independent value comparison. */
const arr = (u: Uint8Array): number[] => [...u];

interface BifFile {
    fileIndex: number;
    type: number;
    data: Uint8Array;
}
interface BifTileset {
    tilesetIndex: number;
    type: number;
    tileSize: number;
    data: Uint8Array;
}

/**
 * Build a plain 'BIFF' V1 archive: header | file entries | tileset entries | data.
 * The header is sig(4)+ver(4)+fileCount(4)+tilesetCount(4)+fileEntriesOffset(4) = 20 bytes;
 * fileEntriesOffset points just past it, and each entry's dataOffset is filled in below.
 */
function buildBif(files: BifFile[], tilesets: BifTileset[] = []): Uint8Array {
    const headerBytes = 20;
    const fileEntriesOffset = headerBytes;
    const tableBytes = files.length * 16 + tilesets.length * 20;
    let dataPos = fileEntriesOffset + tableBytes;
    const fileOffsets = files.map((f) => {
        const o = dataPos;
        dataPos += f.data.byteLength;
        return o;
    });
    const tilesetOffsets = tilesets.map((t) => {
        const o = dataPos;
        dataPos += t.data.byteLength;
        return o;
    });

    const buf = new Uint8Array(dataPos);
    const dv = new DataView(buf.buffer);
    writeStr(dv, 0, "BIFF");
    writeStr(dv, 4, "V1  ");
    dv.setUint32(8, files.length, true);
    dv.setUint32(12, tilesets.length, true);
    dv.setUint32(16, fileEntriesOffset, true);

    let p = fileEntriesOffset;
    files.forEach((f, i) => {
        dv.setUint32(p, f.fileIndex & 0x3fff, true);
        dv.setUint32(p + 4, fileOffsets[i]!, true);
        dv.setUint32(p + 8, f.data.byteLength, true);
        dv.setUint16(p + 12, f.type, true);
        dv.setUint16(p + 14, 0, true);
        buf.set(f.data, fileOffsets[i]!);
        p += 16;
    });
    tilesets.forEach((t, i) => {
        dv.setUint32(p, (t.tilesetIndex & 0x3f) << 14, true);
        dv.setUint32(p + 4, tilesetOffsets[i]!, true);
        dv.setUint32(p + 8, t.data.byteLength / t.tileSize, true);
        dv.setUint32(p + 12, t.tileSize, true);
        dv.setUint16(p + 16, t.type, true);
        dv.setUint16(p + 18, 0, true);
        buf.set(t.data, tilesetOffsets[i]!);
        p += 20;
    });
    return buf;
}

interface KeyBif {
    name: string;
    fileLength: number;
}
interface KeyRes {
    resref: string;
    type: number;
    bifIndex: number;
    tilesetIndex: number;
    fileIndex: number;
}

/** Build a 'KEY ' V1 index: header | bif entries | resource entries | name strings. */
function buildKey(bifs: KeyBif[], resources: KeyRes[]): Uint8Array {
    const headerBytes = 24;
    const bifOffset = headerBytes;
    const resOffset = bifOffset + bifs.length * 12;
    let namePos = resOffset + resources.length * 14;
    const nameOffsets = bifs.map((b) => {
        const o = namePos;
        namePos += b.name.length + 1; // ASCIIZ
        return o;
    });

    const buf = new Uint8Array(namePos);
    const dv = new DataView(buf.buffer);
    writeStr(dv, 0, "KEY ");
    writeStr(dv, 4, "V1  ");
    dv.setUint32(8, bifs.length, true);
    dv.setUint32(12, resources.length, true);
    dv.setUint32(16, bifOffset, true);
    dv.setUint32(20, resOffset, true);

    bifs.forEach((b, i) => {
        const p = bifOffset + i * 12;
        dv.setUint32(p, b.fileLength, true);
        dv.setUint32(p + 4, nameOffsets[i]!, true);
        dv.setUint16(p + 8, b.name.length + 1, true);
        dv.setUint16(p + 10, 0, true);
        writeStr(dv, nameOffsets[i]!, b.name); // trailing NUL already zeroed
    });
    resources.forEach((r, i) => {
        const p = resOffset + i * 14;
        writeStr(dv, p, r.resref); // 8-byte field, remaining bytes stay NUL
        dv.setUint16(p + 8, r.type, true);
        const locator = ((r.bifIndex & 0xfff) << 20) | ((r.tilesetIndex & 0x3f) << 14) | (r.fileIndex & 0x3fff);
        dv.setUint32(p + 10, locator >>> 0, true);
    });
    return buf;
}

/** Wrap a plain BIFF in the BIFC ('BIF ' V1) whole-stream compressed shape. */
function buildBifcWhole(inner: Uint8Array): Uint8Array {
    const filename = "test.bif";
    const comp = zlib.deflateSync(inner);
    const buf = new Uint8Array(12 + filename.length + 8 + comp.byteLength);
    const dv = new DataView(buf.buffer);
    writeStr(dv, 0, "BIF ");
    writeStr(dv, 4, "V1.0");
    dv.setUint32(8, filename.length, true);
    writeStr(dv, 12, filename);
    let p = 12 + filename.length;
    dv.setUint32(p, inner.byteLength, true);
    p += 4;
    dv.setUint32(p, comp.byteLength, true);
    p += 4;
    buf.set(comp, p);
    return buf;
}

/** Wrap a plain BIFF in the BIFC V1.0 block-compressed shape (two blocks, to exercise the loop). */
function buildBifcBlocks(inner: Uint8Array): Uint8Array {
    const mid = Math.floor(inner.byteLength / 2);
    const chunks = [inner.subarray(0, mid), inner.subarray(mid)];
    const blocks = chunks.map((c) => ({ raw: c, comp: zlib.deflateSync(c) }));
    const size = 12 + blocks.reduce((s, b) => s + 8 + b.comp.byteLength, 0);
    const buf = new Uint8Array(size);
    const dv = new DataView(buf.buffer);
    writeStr(dv, 0, "BIFC");
    writeStr(dv, 4, "V1.0");
    dv.setUint32(8, inner.byteLength, true);
    let p = 12;
    for (const b of blocks) {
        dv.setUint32(p, b.raw.byteLength, true);
        dv.setUint32(p + 4, b.comp.byteLength, true);
        buf.set(b.comp, p + 8);
        p += 8 + b.comp.byteLength;
    }
    return buf;
}

/**
 * Build a 'TLK ' V1 string table: header(18) | entries(26 each) | strings. Each item is a string (UTF-8),
 * raw bytes (for encoding cases), or null for a no-text entry (flags bit 0 clear).
 */
function buildTlk(strings: (string | Uint8Array | null)[], langId = 0): Uint8Array {
    const count = strings.length;
    const stringsOffset = 18 + count * 26;
    const encoded = strings.map((s) =>
        s === null ? new Uint8Array(0) : typeof s === "string" ? new TextEncoder().encode(s) : s,
    );
    let pos = 0;
    const offsets = encoded.map((e) => {
        const o = pos;
        pos += e.byteLength;
        return o;
    });

    const buf = new Uint8Array(stringsOffset + pos);
    const dv = new DataView(buf.buffer);
    writeStr(dv, 0, "TLK ");
    writeStr(dv, 4, "V1  ");
    dv.setUint16(8, langId, true);
    dv.setUint32(10, count, true);
    dv.setUint32(14, stringsOffset, true);
    strings.forEach((s, i) => {
        const p = 18 + i * 26;
        dv.setUint16(p, s === null ? 0 : 1, true); // flags: bit 0 = text exists
        dv.setUint32(p + 18, offsets[i]!, true); // string offset (relative to strings section)
        dv.setUint32(p + 22, encoded[i]!.byteLength, true); // string length
        buf.set(encoded[i]!, stringsOffset + offsets[i]!);
    });
    return buf;
}

const ITEM_DATA = Uint8Array.from([1, 2, 3, 4, 5]);
const SPELL_DATA = Uint8Array.from([9, 8, 7]);
const TILE_DATA = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd]); // 2 tiles x 2 bytes

function sampleBif(): Uint8Array {
    return buildBif(
        [
            { fileIndex: 0, type: RESTYPE_ITM, data: ITEM_DATA },
            { fileIndex: 1, type: RESTYPE_SPL, data: SPELL_DATA },
        ],
        [{ tilesetIndex: 3, type: RESTYPE_TIS, tileSize: 2, data: TILE_DATA }],
    );
}

function sampleKey(): Uint8Array {
    return buildKey(
        [{ name: "data\\test.bif", fileLength: 999 }],
        [
            { resref: "item01", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 0 },
            { resref: "spell1", type: RESTYPE_SPL, bifIndex: 0, tilesetIndex: 0, fileIndex: 1 },
            { resref: "area01", type: RESTYPE_TIS, bifIndex: 0, tilesetIndex: 3, fileIndex: 0 },
        ],
    );
}

describe("resource-type table", () => {
    it("maps codes to extensions and back", () => {
        expect(resourceTypeExt(RESTYPE_ITM)).toBe("itm");
        expect(resourceTypeExt(RESTYPE_TIS)).toBe("tis");
        expect(resourceTypeExt(0xdead)).toBeUndefined();
        expect(resourceTypeCode("itm")).toBe(RESTYPE_ITM);
        expect(resourceTypeCode(".ITM")).toBe(RESTYPE_ITM);
        expect(resourceTypeCode("nope")).toBeUndefined();
    });
});

describe("parseKey", () => {
    it("reads bif table, resources, and unpacks the locator", () => {
        const key = parseKey(sampleKey());
        expect(key.bifs).toHaveLength(1);
        expect(key.bifs[0]!.name).toBe("data/test.bif"); // backslash normalized
        expect(key.bifs[0]!.fileLength).toBe(999);

        expect(key.resources).toHaveLength(3);
        const spell = key.resources[1]!;
        expect(spell.resref).toBe("SPELL1"); // NUL-trimmed, uppercased
        expect(spell.type).toBe(RESTYPE_SPL);
        expect(spell.ext).toBe("spl");
        expect(spell.bifIndex).toBe(0);
        expect(spell.fileIndex).toBe(1);

        const tis = key.resources[2]!;
        expect(tis.tilesetIndex).toBe(3);
    });

    it("finds by resref (case-insensitive) and by resref+type", () => {
        const key = parseKey(sampleKey());
        expect(key.lookup("ITEM01")!.fileIndex).toBe(0);
        expect(key.lookup("item01")!.type).toBe(RESTYPE_ITM);
        expect(key.lookup("spell1", RESTYPE_SPL)!.fileIndex).toBe(1);
        expect(key.lookup("spell1", RESTYPE_ITM)).toBeUndefined();
        expect(key.lookup("missing")).toBeUndefined();
    });

    it("resolves a duplicate resref+type to the LAST KEY entry (last-wins) and lists all in order", () => {
        const key = parseKey(
            buildKey(
                [
                    { name: "base.bif", fileLength: 0 },
                    { name: "patch.bif", fileLength: 0 },
                ],
                [
                    { resref: "dup", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 5 },
                    { resref: "dup", type: RESTYPE_ITM, bifIndex: 1, tilesetIndex: 0, fileIndex: 9 },
                ],
            ),
        );
        const winner = key.lookup("dup", RESTYPE_ITM)!;
        expect(winner.bifIndex).toBe(1); // the later (patch) BIF, not the first
        expect(winner.fileIndex).toBe(9);
        expect(key.lookupAll("dup", RESTYPE_ITM).map((r) => r.bifIndex)).toEqual([0, 1]);
    });

    it("rejects a non-KEY buffer", () => {
        const bytes = new Uint8Array(24);
        writeStr(new DataView(bytes.buffer), 0, "NOPE");
        expect(() => parseKey(bytes)).toThrow(/Not a KEY V1/);
    });

    it("rejects a header pointing past EOF", () => {
        const key = sampleKey();
        new DataView(key.buffer).setUint32(16, 0xffff, true); // bifOffset out of range
        expect(() => parseKey(key)).toThrow(/exceeds file size/);
    });
});

describe("openBif / parseBif (plain)", () => {
    it("extracts a file resource by its exact bytes", () => {
        const bif = parseBif(sampleBif());
        expect(bif.compressed).toBe(false);
        expect(bif.files.size).toBe(2);
        expect(arr(bif.readFile(0))).toEqual(arr(ITEM_DATA));
        expect(arr(bif.readFile(1))).toEqual(arr(SPELL_DATA));
        bif.close();
    });

    it("extracts a tileset resource", () => {
        const bif = parseBif(sampleBif());
        expect(bif.tilesets.size).toBe(1);
        expect(arr(bif.readTileset(3))).toEqual(arr(TILE_DATA));
        bif.close();
    });

    it("throws for an unknown file or tileset index", () => {
        const bif = parseBif(sampleBif());
        expect(() => bif.readFile(99)).toThrow(/No file index/);
        expect(() => bif.readTileset(99)).toThrow(/No tileset index/);
        bif.close();
    });

    it("rejects an unrecognized signature", () => {
        const bytes = new Uint8Array(16);
        writeStr(new DataView(bytes.buffer), 0, "XXXX");
        expect(() => openBif(bufferSource(bytes))).toThrow(/Unrecognized BIF signature/);
    });
});

describe("openBif (compressed)", () => {
    it("inflates a BIFC whole-stream archive to the same files", () => {
        const bif = openBif(bufferSource(buildBifcWhole(sampleBif())));
        expect(bif.compressed).toBe(true);
        expect(arr(bif.readFile(0))).toEqual(arr(ITEM_DATA));
        expect(arr(bif.readFile(1))).toEqual(arr(SPELL_DATA));
        bif.close();
    });

    /**
     * The BIFC header's uncompressed total is a `u32` read straight from the file, so it must not size an
     * allocation: a corrupt or hostile value reserves that much before a single block is inflated, and the
     * inflated archive keeps a view on it for its whole lifetime. Asserting the extracted bytes alone would
     * not catch this - the archive reads back correctly either way, just off a buffer sized by the file's
     * claim. So the assertion is on the BACKING store, which is the only place the difference shows.
     */
    it("sizes a BIFC V1.0 archive by what inflates, not by its declared uncompressed size", () => {
        const bytes = buildBifcBlocks(sampleBif());
        const declared = 0x1000_0000; // 256 MB, against an archive of a few dozen bytes
        new DataView(bytes.buffer).setUint32(8, declared, true);
        const bif = openBif(bufferSource(bytes));
        try {
            expect(arr(bif.readFile(0))).toEqual(arr(ITEM_DATA));
            expect(bif.readFile(0).buffer.byteLength).toBeLessThan(declared);
        } finally {
            bif.close();
        }
    });

    it("inflates a BIFC V1.0 block-compressed archive to the same files", () => {
        const bif = openBif(bufferSource(buildBifcBlocks(sampleBif())));
        expect(bif.compressed).toBe(true);
        expect(arr(bif.readFile(0))).toEqual(arr(ITEM_DATA));
        expect(arr(bif.readTileset(3))).toEqual(arr(TILE_DATA));
        bif.close();
    });
});

describe("byte-source bounds", () => {
    it("throws on an out-of-bounds read", () => {
        const src = bufferSource(Uint8Array.from([1, 2, 3]));
        expect(() => src.read(2, 5)).toThrow(/out of bounds/);
        expect(() => src.read(-1, 1)).toThrow(/Invalid read/);
    });
});

describe("TLK (dialog.tlk)", () => {
    it("resolves strrefs to text, empty entries, and out-of-range", () => {
        const tlk = parseTlk(buildTlk(["Hello world", null, "Greetings <CHARNAME>"]));
        expect(tlk.count).toBe(3);
        expect(tlk.get(0)).toBe("Hello world");
        expect(tlk.get(1)).toBe(""); // no-text entry
        expect(tlk.get(2)).toBe("Greetings <CHARNAME>");
        expect(tlk.get(3)).toBeUndefined(); // past the end
        expect(tlk.get(-1)).toBeUndefined(); // the 0xffffffff "no string" sentinel
        tlk.close();
    });

    it("trims a NUL-terminated string within its declared length", () => {
        const tlk = parseTlk(buildTlk([Uint8Array.from([0x48, 0x69, 0x00, 0x58])])); // "Hi\0X"
        expect(tlk.get(0)).toBe("Hi");
        tlk.close();
    });

    it("with no encoding, falls back to windows-1252 for non-UTF-8 bytes", () => {
        const tlk = parseTlk(buildTlk([Uint8Array.from([0xe9])])); // 0xE9 invalid UTF-8; cp1252 -> U+00E9 e-acute
        expect(tlk.get(0)).toBe("\u00E9");
        tlk.close();
    });

    it("decodes with an explicit codepage - windows ANSI is not always cp1252", () => {
        const bytes = buildTlk([Uint8Array.from([0xc0])]);
        expect(parseTlk(bytes, { encoding: "windows-1252" }).get(0)).toBe("\u00C0"); // A-grave (Latin)
        expect(parseTlk(bytes, { encoding: "windows-1251" }).get(0)).toBe("\u0410"); // Cyrillic A - different code point
    });

    it("throws on an unsupported encoding label", () => {
        expect(() => parseTlk(buildTlk(["x"]), { encoding: "not-an-encoding" })).toThrow();
    });

    describe("search", () => {
        const SAMPLE = ["Sword of Chaos", "a sword +1", null, "Shield", "SWORDFISH", ""];

        it("matches text case-insensitively, reporting each hit's strref", () => {
            const tlk = parseTlk(buildTlk(SAMPLE));
            expect(tlk.search("sword")).toEqual([
                { strref: 0, text: "Sword of Chaos" },
                { strref: 1, text: "a sword +1" },
                { strref: 4, text: "SWORDFISH" },
            ]);
            tlk.close();
        });

        it("returns hits in strref order, which is the order the game numbers them", () => {
            const tlk = parseTlk(buildTlk(SAMPLE));
            expect(tlk.search("s").map((hit) => hit.strref)).toEqual([0, 1, 3, 4]);
            tlk.close();
        });

        it("stops at the requested limit, so a common word cannot return the whole table", () => {
            const tlk = parseTlk(buildTlk(SAMPLE));
            expect(tlk.search("s", { limit: 2 }).map((hit) => hit.strref)).toEqual([0, 1]);
            tlk.close();
        });

        it("skips entries the table holds no text for", () => {
            const tlk = parseTlk(buildTlk(SAMPLE));
            // Index 2 is a no-text entry and index 5 an empty string; neither can match anything.
            expect(tlk.search("").map((hit) => hit.strref)).not.toContain(2);
            expect(tlk.search("").map((hit) => hit.strref)).not.toContain(5);
            tlk.close();
        });

        it("finds nothing for a query no entry contains", () => {
            const tlk = parseTlk(buildTlk(SAMPLE));
            expect(tlk.search("halberd")).toEqual([]);
            tlk.close();
        });

        it("decodes with the configured codepage, so a match is on the text the player sees", () => {
            const tlk = parseTlk(buildTlk([Uint8Array.from([0xc0, 0x42])]), { encoding: "windows-1251" });
            expect(tlk.search("\u0410B")).toEqual([{ strref: 0, text: "\u0410B" }]);
            tlk.close();
        });

        it("reads the table once however many searches are run", () => {
            const bytes = buildTlk(SAMPLE);
            let reads = 0;
            const counting: ByteSource = {
                size: bytes.byteLength,
                read(offset, length) {
                    reads++;
                    return bytes.subarray(offset, offset + length);
                },
                close() {},
            };
            const tlk = openTlk(counting);
            tlk.search("sword");
            const afterFirst = reads;
            tlk.search("shield");
            tlk.search("fish");
            expect(reads).toBe(afterFirst);
        });
    });

    /**
     * A record's fields resolve one strref at a time and every message re-resolves them - a CRE alone carries
     * 100 sound-slot strrefs - so an uncached `get` turns one panel refresh into hundreds of positioned reads
     * on the host thread. Counted at the byte source, which is the only place the saving is observable.
     */
    it("reads a strref from the source once, then answers from cache", () => {
        const bytes = buildTlk(["Sword +1", "Fire!"]);
        let reads = 0;
        const counting: ByteSource = {
            size: bytes.byteLength,
            read(offset, length) {
                reads++;
                return bytes.subarray(offset, offset + length);
            },
            close() {},
        };
        const tlk = openTlk(counting);
        const afterHeader = reads;

        expect(tlk.get(0)).toBe("Sword +1");
        const afterFirst = reads;
        expect(afterFirst).toBeGreaterThan(afterHeader); // the entry and its string

        expect(tlk.get(0)).toBe("Sword +1");
        expect(reads).toBe(afterFirst); // repeat resolved from cache

        // A different strref is a genuine miss, so caching must not answer it from the first one's entry.
        expect(tlk.get(1)).toBe("Fire!");
        expect(reads).toBeGreaterThan(afterFirst);
        tlk.close();
    });

    // An out-of-range strref must stay undefined however often it is asked, and must not occupy a cache slot
    // that a later in-range lookup could collide with. -1 is the format-wide "no string", so it is the hot path.
    it("caches nothing for an out-of-range strref", () => {
        const tlk = parseTlk(buildTlk(["x"]));
        expect(tlk.get(-1)).toBeUndefined();
        expect(tlk.get(-1)).toBeUndefined();
        expect(tlk.get(9)).toBeUndefined();
        expect(tlk.get(0)).toBe("x");
        tlk.close();
    });

    it("carries the language id and rejects a non-TLK buffer", () => {
        const tlk = parseTlk(buildTlk(["x"], 3));
        expect(tlk.languageId).toBe(3);
        tlk.close();
        const bytes = new Uint8Array(18);
        writeStr(new DataView(bytes.buffer), 0, "NOPE");
        expect(() => parseTlk(bytes)).toThrow(/Not a TLK V1/);
    });
});

describe("game identity (WeiDU autodetect)", () => {
    const keyWith = (resources: KeyRes[]) => parseKey(buildKey([{ name: "x.bif", fileLength: 0 }], resources));
    const marker = (resref: string, type: number): KeyRes => ({
        resref,
        type,
        bifIndex: 0,
        tilesetIndex: 0,
        fileIndex: 0,
    });

    it("defaults to classic BG1 when no marker is present", () => {
        expect(detectGameIdentity(keyWith([]))).toMatchObject({
            variant: "generic",
            scriptStyle: "bg1",
            edition: "classic",
            shortLabel: "BG1",
        });
    });

    it("detects BG2:EE via OH6000.ARE", () => {
        const id = detectGameIdentity(keyWith([marker("OH6000", RESTYPE_ARE)]));
        expect(id.variant).toBe("bg2ee");
        expect(id.edition).toBe("ee");
        expect(id.label).toBe("Baldur's Gate II: Enhanced Edition");
        expect(id.shortLabel).toBe("BG2EE");
    });

    it("detects classic IWD2 via SUBRACE.IDS", () => {
        expect(detectGameIdentity(keyWith([marker("SUBRACE", RESTYPE_IDS)]))).toMatchObject({
            variant: "generic",
            scriptStyle: "iwd2",
            edition: "classic",
            shortLabel: "IWD2",
        });
    });

    it("last marker wins: an EE marker overrides the classic FLYTHR01 one", () => {
        // BG2:EE has both FLYTHR01.MVE (BG2 content) and OH6000.ARE; OH6000 is later in WeiDU's order, so EE wins.
        const id = detectGameIdentity(keyWith([marker("FLYTHR01", RESTYPE_MVE), marker("OH6000", RESTYPE_ARE)]));
        expect(id.variant).toBe("bg2ee");
    });

    // Fine flavour via WeiDU's GAME_IS area markers. A ToB install carries both the SoA (AR0083) and ToB
    // (AR6111) areas, so ToB must win; likewise TotSC (AR2003) over BG1 (AR0125).
    it("distinguishes ToB from SoA by the AR6111 area marker", () => {
        const tob = detectGameIdentity(keyWith([marker("AR0083", RESTYPE_ARE), marker("AR6111", RESTYPE_ARE)]));
        expect(tob.flavour).toBe("tob");
        expect(tob.shortLabel).toBe("BG2: ToB");
        expect(tob.label).toBe("Baldur's Gate II: Throne of Bhaal");
        const soa = detectGameIdentity(keyWith([marker("AR0083", RESTYPE_ARE)]));
        expect(soa.flavour).toBe("bg2");
        expect(soa.shortLabel).toBe("BG2: SoA");
    });

    it("distinguishes TotSC from BG1 by the AR2003 area marker", () => {
        const totsc = detectGameIdentity(keyWith([marker("AR0125", RESTYPE_ARE), marker("AR2003", RESTYPE_ARE)]));
        expect(totsc.flavour).toBe("totsc");
        expect(totsc.shortLabel).toBe("BG1: TotSC");
        const bg1 = detectGameIdentity(keyWith([marker("AR0125", RESTYPE_ARE)]));
        expect(bg1.flavour).toBe("bg1");
        expect(bg1.shortLabel).toBe("BG1");
    });
});

describe("openGame (real filesystem)", () => {
    const tmpDirs: string[] = [];
    afterEach(() => {
        for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    });

    // `files` places extra files at paths relative to the game dir (e.g. "override/item01.itm",
    // "characters/item01.itm", "lang/en_US/sounds/foo.wav"); parent dirs are created as needed.
    function makeGameDir(files: Record<string, Uint8Array> = {}, extraKeyResources: KeyRes[] = []): string {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-key-bif-"));
        tmpDirs.push(dir);
        // KEY references "data\test.bif" (backslash); place the real file under a lowercase dir,
        // but reference it via an uppercase path segment to exercise case-insensitive resolution.
        const key = buildKey(
            [{ name: "DATA\\TEST.BIF", fileLength: 0 }],
            [
                { resref: "item01", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 0 },
                { resref: "area01", type: RESTYPE_TIS, bifIndex: 0, tilesetIndex: 3, fileIndex: 0 },
                ...extraKeyResources,
            ],
        );
        fs.writeFileSync(path.join(dir, "chitin.key"), key);
        fs.mkdirSync(path.join(dir, "data"));
        fs.writeFileSync(path.join(dir, "data", "test.bif"), sampleBif());
        for (const [rel, data] of Object.entries(files)) {
            const abs = path.join(dir, rel);
            fs.mkdirSync(path.dirname(abs), { recursive: true });
            fs.writeFileSync(abs, data);
        }
        return dir;
    }

    it("lists and extracts resources by extension and by resType number", () => {
        const game = openGame(makeGameDir());
        try {
            const list = game.list();
            expect(list).toContainEqual({ resref: "ITEM01", type: RESTYPE_ITM, ext: "itm", bif: "DATA/TEST.BIF" });

            expect(arr(game.read("item01", "itm"))).toEqual(arr(ITEM_DATA));
            expect(arr(game.read("ITEM01", RESTYPE_ITM))).toEqual(arr(ITEM_DATA));
            // TIS routes through the tileset index, not the file index.
            expect(arr(game.read("area01", "tis"))).toEqual(arr(TILE_DATA));
        } finally {
            game.close();
        }
    });

    // The game's own IDS tables are what name its slots (BG1 SOUNDOFF.IDS and BG2 SNDSLOT.IDS disagree on most
    // sound slots, and mods extend them), so the reader has to come from the install, not a vendored copy.
    it("reads an IDS table from the game by name", () => {
        const sndslot = new TextEncoder().encode("IDS V1.0\r\n0 INITIAL_MEETING\r\n1 MORALE\r\n");
        const game = openGame(makeGameDir({ "override/sndslot.ids": sndslot }));
        try {
            expect(game.ids("SNDSLOT")?.get(0)).toBe("INITIAL_MEETING");
            expect(game.ids("sndslot")?.get(1)).toBe("MORALE");
        } finally {
            game.close();
        }
    });

    /**
     * The path the editor's naming-table resolver takes - install file through to `Game.ids` - over a table
     * whose identifiers carry spaces. MISSILE.IDS is the shipped case: it names projectiles in prose, so a
     * reader that stops at the first token drops 250 of BG2:ToB's 279 rows and the projectile dropdown loses
     * them silently, the table still reporting itself as present.
     */
    it("reads a table whose identifiers contain spaces", () => {
        const missile = new TextEncoder().encode("IDS\r\n2 Arrow\r\n3 Arrow Exploding\r\n");
        const game = openGame(makeGameDir({ "override/missile.ids": missile }));
        try {
            expect(game.ids("MISSILE")?.get(3)).toBe("Arrow Exploding");
        } finally {
            game.close();
        }
    });

    /**
     * A script decompiler cannot use `ids`: BG2:ToB's ACTION.IDS names 32 ids twice, and id 160's two rows take
     * different argument types, so the record decides which was meant. One row per value cannot express that.
     */
    it("reads every row for a value, not just the winning one", () => {
        const action = new TextEncoder().encode("IDS V1.0\r\n8 Dialogue(O:Object*)\r\n8 Dialog(O:Object*)\r\n");
        const game = openGame(makeGameDir({ "override/action.ids": action }));
        try {
            expect(game.ids("ACTION")?.get(8)).toBe("Dialog(O:Object*)");
            expect(game.idsAll("ACTION")?.get(8)).toEqual(["Dialogue(O:Object*)", "Dialog(O:Object*)"]);
        } finally {
            game.close();
        }
    });

    it("reports an absent IDS table rather than throwing", () => {
        const game = openGame(makeGameDir());
        try {
            expect(game.ids("SNDSLOT")).toBeUndefined();
        } finally {
            game.close();
        }
    });

    it("reuses one open BIF across reads and reports missing resources", () => {
        const game = openGame(makeGameDir());
        try {
            game.read("item01");
            game.read("item01"); // second read hits the cached archive
            expect(() => game.read("nothere")).toThrow(/Resource not found/);
            expect(() => game.read("item01", "zzz")).toThrow(/Unknown resource extension/);
        } finally {
            game.close();
        }
    });

    it("prefers an override/ loose file over the biffed copy, and reflects it in list()", () => {
        const OVERRIDE_ITEM = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
        const game = openGame(makeGameDir({ "override/item01.itm": OVERRIDE_ITEM }));
        try {
            // override wins for the shadowed resource, whether or not a type is passed...
            expect(arr(game.read("item01", "itm"))).toEqual(arr(OVERRIDE_ITEM));
            expect(arr(game.read("item01"))).toEqual(arr(OVERRIDE_ITEM)); // type resolved via KEY, then override probed
            // ...but a BIF-only resource still comes from the BIF.
            expect(arr(game.read("area01", "tis"))).toEqual(arr(TILE_DATA));
            expect(game.list()).toContainEqual({
                resref: "ITEM01",
                type: RESTYPE_ITM,
                ext: "itm",
                bif: "override/item01.itm",
            });
        } finally {
            game.close();
        }
    });

    it("engine mode honors the full priority stack (characters > override); weidu mode ignores it", () => {
        const IN_OVERRIDE = Uint8Array.from([1, 1, 1, 1]);
        const IN_CHARACTERS = Uint8Array.from([2, 2, 2, 2]);
        const files = { "override/item01.itm": IN_OVERRIDE, "characters/item01.itm": IN_CHARACTERS };

        const engine = openGame(makeGameDir(files), { mode: "engine" });
        try {
            // characters/ outranks override/ (IESDP override.htm), so its copy wins.
            expect(arr(engine.read("item01", "itm"))).toEqual(arr(IN_CHARACTERS));
            expect(engine.list()).toContainEqual({
                resref: "ITEM01",
                type: RESTYPE_ITM,
                ext: "itm",
                bif: "characters/item01.itm",
            });
        } finally {
            engine.close();
        }

        // WeiDU mode (default) never looks in characters/, so the override/ copy wins.
        const weidu = openGame(makeGameDir(files));
        try {
            expect(arr(weidu.read("item01", "itm"))).toEqual(arr(IN_OVERRIDE));
        } finally {
            weidu.close();
        }
    });

    it("matches override filenames case-insensitively", () => {
        const DATA = Uint8Array.from([7, 7, 7]);
        const game = openGame(makeGameDir({ "override/Item01.ITM": DATA }));
        try {
            expect(arr(game.read("item01", "itm"))).toEqual(arr(DATA));
            expect(arr(game.read("ITEM01", ".ITM"))).toEqual(arr(DATA));
        } finally {
            game.close();
        }
    });

    it("rescan picks up override files another tool wrote, and drops ones it deleted", () => {
        const OUTSIDE_EDIT = Uint8Array.from([0x5a, 0x5a]);
        const OVERRIDE_ITEM = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
        const dir = makeGameDir({ "override/item01.itm": OVERRIDE_ITEM });
        const game = openGame(dir);
        try {
            expect(arr(game.read("item01", "itm"))).toEqual(arr(OVERRIDE_ITEM));
            expect(game.list().some((r) => r.resref === "NEWMOD")).toBe(false);

            // Another tool mutates override/ behind the open game: one resource added, one removed.
            fs.writeFileSync(path.join(dir, "override", "newmod.itm"), OUTSIDE_EDIT);
            fs.rmSync(path.join(dir, "override", "item01.itm"));

            // Nothing is visible until the rescan - the tree is built once at open.
            expect(game.list().some((r) => r.resref === "NEWMOD")).toBe(false);
            game.rescan();

            expect(arr(game.read("newmod", "itm"))).toEqual(arr(OUTSIDE_EDIT));
            // The deleted override stops shadowing the biffed copy rather than vanishing outright.
            expect(arr(game.read("item01", "itm"))).toEqual(arr(ITEM_DATA));
            expect(game.list()).toContainEqual({
                resref: "ITEM01",
                type: RESTYPE_ITM,
                ext: "itm",
                bif: "DATA/TEST.BIF",
            });
        } finally {
            game.close();
        }
    });

    it("rescan drops a resource whose only source was a deleted override file", () => {
        const dir = makeGameDir({ "override/newmod.itm": Uint8Array.from([7, 7]) });
        const game = openGame(dir);
        try {
            expect(game.list().some((r) => r.resref === "NEWMOD")).toBe(true);
            fs.rmSync(path.join(dir, "override", "newmod.itm"));
            game.rescan();
            expect(game.list().some((r) => r.resref === "NEWMOD")).toBe(false);
            expect(game.canRead("newmod", "itm")).toBe(false);
        } finally {
            game.close();
        }
    });

    // A KEY's BIF names are untrusted file bytes: `..` or an absolute name would address files outside the
    // install. Real KEYs use neither, so resolution refuses them rather than walking out of the game dir.
    it.each([
        { label: "a parent-dir escape", name: "../outside/escaped.bif" },
        { label: "an absolute path", name: "/outside/escaped.bif" },
    ])("refuses to load a BIF named via $label", ({ name }) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-key-escape-"));
        tmpDirs.push(root);
        const gameDir = path.join(root, "game");
        fs.mkdirSync(path.join(root, "outside"), { recursive: true });
        fs.mkdirSync(gameDir, { recursive: true });
        // A syntactically valid BIF outside the install: resolution must never reach it, so a failure here
        // cannot be mistaken for the archive merely being absent.
        fs.writeFileSync(path.join(root, "outside", "escaped.bif"), sampleBif());
        fs.writeFileSync(
            path.join(gameDir, "chitin.key"),
            buildKey(
                [{ name, fileLength: 0 }],
                [{ resref: "item01", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 0 }],
            ),
        );

        const game = openGame(gameDir, { mode: "engine" });
        try {
            expect(() => game.read("item01", "itm")).toThrow(/Refusing to load BIF outside the game directory/);
            expect(game.canRead("item01", "itm")).toBe(false);
        } finally {
            game.close();
        }
    });

    it("searches lang/<lang> folders only in engine mode with that language set", () => {
        const VOICE = Uint8Array.from([0x11, 0x22]);
        const dir = makeGameDir({ "lang/en_US/sounds/voice1.wav": VOICE });
        const withLang = openGame(dir, { mode: "engine", lang: "en_US" });
        try {
            expect(arr(withLang.read("voice1", "wav"))).toEqual(arr(VOICE));
        } finally {
            withLang.close();
        }
        // WeiDU default (override/ only) does not search lang folders -> not found (absent from chitin.key too).
        const noLang = openGame(dir);
        try {
            expect(() => noLang.read("voice1", "wav")).toThrow(/Resource not found/);
        } finally {
            noLang.close();
        }
    });

    it("reads an override-only resource that is absent from chitin.key", () => {
        const NEW_ITEM = Uint8Array.from([1, 1, 2, 3, 5, 8]);
        const game = openGame(makeGameDir({ "override/newmod.itm": NEW_ITEM }));
        try {
            expect(arr(game.read("newmod", "itm"))).toEqual(arr(NEW_ITEM));
            expect(game.list()).toContainEqual({
                resref: "NEWMOD",
                type: RESTYPE_ITM,
                ext: "itm",
                bif: "override/newmod.itm",
            });
        } finally {
            game.close();
        }
    });

    it("write() installs to override, is read back with no re-scan, and shadows the BIF", () => {
        const NEW = Uint8Array.from([0xca, 0xfe, 0x00, 0x01]);
        const dir = makeGameDir();
        const game = openGame(dir);
        try {
            game.write("item01", "itm", NEW); // item01 was biffed; now overridden in place
            expect(arr(game.read("item01", "itm"))).toEqual(arr(NEW));
            expect(fs.existsSync(path.join(dir, "override", "item01.itm"))).toBe(true);
            expect(game.list()).toContainEqual({
                resref: "ITEM01",
                type: RESTYPE_ITM,
                ext: "itm",
                bif: "override/item01.itm",
            });
            // The atomic write leaves no temp file behind.
            expect(fs.readdirSync(path.join(dir, "override")).some((n) => n.includes(".tmp"))).toBe(false);
        } finally {
            game.close();
        }
    });

    it("remove() deletes the loose file and the winner falls back to the BIF", () => {
        const game = openGame(makeGameDir());
        try {
            game.write("item01", "itm", Uint8Array.from([9, 9]));
            expect(game.remove("item01", "itm")).toBe(true);
            expect(arr(game.read("item01", "itm"))).toEqual(arr(ITEM_DATA)); // back to the biffed copy
            expect(game.remove("item01", "itm")).toBe(false); // nothing left to remove
        } finally {
            game.close();
        }
    });

    it("write()/remove() of an override-only resource adds then drops it from the tree", () => {
        const dir = makeGameDir();
        const game = openGame(dir);
        const DATA = Uint8Array.from([3, 1, 4, 1, 5]);
        try {
            game.write("brandnew", "itm", DATA);
            expect(arr(game.read("brandnew", "itm"))).toEqual(arr(DATA));
            expect(game.remove("brandnew", "itm")).toBe(true);
            expect(() => game.read("brandnew", "itm")).toThrow(/Resource not found/);
            expect(fs.existsSync(path.join(dir, "override", "brandnew.itm"))).toBe(false);
        } finally {
            game.close();
        }
    });

    it("write() rejects a folder outside the configured override stack", () => {
        const game = openGame(makeGameDir()); // default stack is [override] only
        try {
            expect(() => game.write("x", "itm", Uint8Array.from([0]), { folder: "characters" })).toThrow(
                /not one of the override folders/,
            );
        } finally {
            game.close();
        }
    });

    it("writeAuxFile/readAuxFile round-trip a non-resource sidecar in override without indexing it", () => {
        const dir = makeGameDir();
        const game = openGame(dir);
        try {
            const json = new TextEncoder().encode('{"weight":42}');
            const written = game.writeAuxFile("item01.itm.json", json);
            expect(written).toBe(path.join(dir, "override", "item01.itm.json")); // lowercased, in override
            expect(arr(game.readAuxFile("item01.itm.json")!)).toEqual(arr(json));
            expect(game.readAuxFile("missing.json")).toBeUndefined();
            // A .json has no resType, so it is never surfaced as a game resource.
            expect(game.list().some((r) => r.ext === "json")).toBe(false);
        } finally {
            game.close();
        }
        // A re-open scans override but still ignores the sidecar (its extension has no resType).
        const reopened = openGame(dir);
        try {
            expect(reopened.list().some((r) => r.ext === "json")).toBe(false);
            expect(reopened.readAuxFile("item01.itm.json")).toBeDefined();
        } finally {
            reopened.close();
        }
    });

    it("finds a biff under a CD data root, and canRead reflects present vs absent archives", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-bifroot-"));
        tmpDirs.push(dir);
        // Two biffed archives referenced by their data-relative KEY names; only cdgood is installed, cdmiss is
        // absent everywhere (like a PROGTEST.BIF that a KEY still lists).
        const key = buildKey(
            [
                { name: "data\\cdgood.bif", fileLength: 0 },
                { name: "data\\cdmiss.bif", fileLength: 0 },
            ],
            [
                { resref: "goodres", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 0 },
                { resref: "missres", type: RESTYPE_ITM, bifIndex: 1, tilesetIndex: 0, fileIndex: 0 },
            ],
        );
        fs.writeFileSync(path.join(dir, "chitin.key"), key);
        // The biff lives at <game>/data/data/cdgood.bif - the KEY name resolved against the CD root <game>/data,
        // NOT directly under <game>. A single <game>/<name> lookup would miss it.
        fs.mkdirSync(path.join(dir, "data", "data"), { recursive: true });
        fs.writeFileSync(
            path.join(dir, "data", "data", "cdgood.bif"),
            buildBif([{ fileIndex: 0, type: RESTYPE_ITM, data: ITEM_DATA }]),
        );
        const game = openGame(dir);
        try {
            expect(arr(game.read("goodres", "itm"))).toEqual(arr(ITEM_DATA));
            expect(game.canRead("goodres", "itm")).toBe(true);
            // Absent archive: canRead is false and read throws the biff-not-found error (handled gracefully upstream).
            expect(game.canRead("missres", "itm")).toBe(false);
            expect(() => game.read("missres", "itm")).toThrow(/BIF file not found/);
        } finally {
            game.close();
        }
    });

    it("honors a baldur.ini [Alias] CD root when the biff is outside the standard data dirs", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-ini-"));
        tmpDirs.push(dir);
        const key = buildKey(
            [{ name: "cddata\\extra.bif", fileLength: 0 }],
            [{ resref: "extra", type: RESTYPE_ITM, bifIndex: 0, tilesetIndex: 0, fileIndex: 0 }],
        );
        fs.writeFileSync(path.join(dir, "chitin.key"), key);
        // baldur.ini maps CD1 to <HD0>/mycd, so the biff resolves under <game>/mycd/cddata/extra.bif - a dir the
        // default roots (data, cache, CD1..CD6) would never reach.
        fs.writeFileSync(path.join(dir, "baldur.ini"), "[Alias]\nHD0:=C:\\game\nCD1:=C:\\game\\mycd\\\n");
        fs.mkdirSync(path.join(dir, "mycd", "cddata"), { recursive: true });
        fs.writeFileSync(
            path.join(dir, "mycd", "cddata", "extra.bif"),
            buildBif([{ fileIndex: 0, type: RESTYPE_ITM, data: ITEM_DATA }]),
        );
        const game = openGame(dir);
        try {
            expect(arr(game.read("extra", "itm"))).toEqual(arr(ITEM_DATA));
        } finally {
            game.close();
        }
    });

    it("refines the flavour for EET / SoD / BGT via override and loose-file markers", () => {
        const byte = Uint8Array.from([0]);
        const areMarker = (resref: string): KeyRes => ({
            resref,
            type: RESTYPE_ARE,
            bifIndex: 0,
            tilesetIndex: 0,
            fileIndex: 9,
        });
        const flavourOf = (files: Record<string, Uint8Array>, markers: KeyRes[]): string => {
            const game = openGame(makeGameDir(files, markers));
            try {
                return game.identity.flavour;
            } finally {
                game.close();
            }
        };
        // EET: a BG2EE base (OH6000) + override/eet.flag -> "eet".
        expect(flavourOf({ "override/eet.flag": byte }, [areMarker("OH6000")])).toBe("eet");
        // SoD: a BGEE base (OH1000) + movies/sodcin01.wbm -> "sod".
        expect(flavourOf({ "movies/sodcin01.wbm": byte }, [areMarker("OH1000")])).toBe("sod");
        // BGT: a BG2/SoA base (AR0083) + override/ar7200.are (resolves in the tree) -> "bgt".
        expect(flavourOf({ "override/ar7200.are": byte }, [areMarker("AR0083")])).toBe("bgt");
        // No conversion marker: the base flavour stands.
        expect(flavourOf({}, [areMarker("AR0083")])).toBe("bg2");
    });

    /**
     * PSTEE is the only flavour a `byFlavour` resref override names today - ITM `replacement` holds a drop
     * SOUND there and an ITEM everywhere else, CRE `largePortrait` a BAM against BMP - so the whole override
     * arm hangs on a PSTEE install reporting this flavour. The declaration and the resolver are each pinned
     * elsewhere (`external-refs.test.ts`, and the client's `createResourceTypeResolver` tests, which stub the
     * flavour); this covers the link between them, which neither of those would notice was broken.
     *
     * It pins the flavour, not the route to it: PSTCHAR.2DA appears in both the coarse variant probe and the
     * fine marker list, and an EE variant is its own fallback flavour, so either one alone still answers
     * "pstee". That redundancy is the reason to assert the observable the resolver reads rather than a marker.
     *
     * Both candidate types are installed under one resref because that is the case `byFlavour` exists for: with
     * an ITM and a WAV both present, nothing but the flavour can say which one the field points at, so probing
     * by presence would answer whichever it happened to find first.
     */
    it("detects PSTEE, where both types a byFlavour resref names can be installed at once", () => {
        const byte = Uint8Array.from([0]);
        const game = openGame(
            makeGameDir({ "override/drop01.itm": byte, "override/drop01.wav": byte }, [
                { resref: "PSTCHAR", type: RESTYPE_2DA, bifIndex: 0, tilesetIndex: 0, fileIndex: 9 },
            ]),
        );
        try {
            expect(game.identity.flavour).toBe("pstee");
            expect(game.identity.edition).toBe("ee");
            expect(game.canRead("drop01", RESTYPE_ITM)).toBe(true);
            expect(game.canRead("drop01", RESTYPE_WAV)).toBe(true);
        } finally {
            game.close();
        }
    });

    it("resolves strrefs via the game's dialog.tlk, and is undefined when the game has none", () => {
        const withTlk = openGame(makeGameDir({ "dialog.tlk": buildTlk(["Sword +1", "Fire!"]) }));
        try {
            expect(withTlk.tlk()?.get(1)).toBe("Fire!");
        } finally {
            withTlk.close();
        }
        const withoutTlk = openGame(makeGameDir());
        try {
            expect(withoutTlk.tlk()).toBeUndefined();
        } finally {
            withoutTlk.close();
        }
    });

    it("finds dialog.tlk under lang/<lang> when a language is set", () => {
        const game = openGame(makeGameDir({ "lang/en_US/dialog.tlk": buildTlk(["Localized"]) }), { lang: "en_US" });
        try {
            expect(game.tlk()?.get(0)).toBe("Localized");
        } finally {
            game.close();
        }
    });

    // WeiDU auto-resolves the EE language folder: weidu.conf's lang_dir names it, else the sorted-first lang
    // subdir with a dialog.tlk. Without this, an EE game opened by the viewer (no explicit lang) shows no
    // strings - real BG:EE keeps dialog.tlk only under lang/<x>/.
    const eeMarker: KeyRes[] = [{ resref: "OH1000", type: RESTYPE_ARE, bifIndex: 0, tilesetIndex: 0, fileIndex: 9 }];

    it("EE: auto-resolves the language folder from weidu.conf (case-insensitively) with no explicit lang", () => {
        // Two lang dirs: de_DE sorts first, so the fallback alone would pick it. weidu.conf names en_US (lowercase
        // "en_us", as EE installs do) and must win - isolating the weidu.conf path from the sorted-first fallback.
        const game = openGame(
            makeGameDir(
                {
                    "lang/de_DE/dialog.tlk": buildTlk(["Deutsch"]),
                    "lang/en_US/dialog.tlk": buildTlk(["English"]),
                    "weidu.conf": new TextEncoder().encode("lang_dir = en_us\n"),
                },
                eeMarker,
            ),
        );
        try {
            expect(game.tlk()?.get(0)).toBe("English");
        } finally {
            game.close();
        }
    });

    it("EE: without weidu.conf, auto-resolves the sorted-first lang subdir that has a dialog.tlk", () => {
        // de_DE sorts before en_US and both carry a dialog.tlk, so de_DE wins - matching WeiDU's fast_sort pick.
        const game = openGame(
            makeGameDir(
                {
                    "lang/en_US/dialog.tlk": buildTlk(["English"]),
                    "lang/de_DE/dialog.tlk": buildTlk(["Deutsch"]),
                },
                eeMarker,
            ),
        );
        try {
            expect(game.tlk()?.get(0)).toBe("Deutsch");
        } finally {
            game.close();
        }
    });

    it("classic: does not auto-scan lang folders (dialog.tlk is read only from the game root)", () => {
        // No EE marker -> classic. A lang/en_US/dialog.tlk must be ignored; only a root dialog.tlk counts.
        const game = openGame(makeGameDir({ "lang/en_US/dialog.tlk": buildTlk(["Ignored"]) }));
        try {
            expect(game.tlk()).toBeUndefined();
        } finally {
            game.close();
        }
    });

    it("reads EE TLK as UTF-8 (detected by a KEY marker, like WeiDU) and classic as windows-1252", () => {
        const utf8 = new TextEncoder().encode("caf\u00E9"); // e-acute is multi-byte in UTF-8
        // EE detection matches WeiDU: an EE marker resource (OH1000.ARE = BGEE) present in the KEY (eeMarker).
        const ee = openGame(makeGameDir({ "dialog.tlk": buildTlk([utf8]) }, eeMarker));
        try {
            expect(ee.tlk()?.get(0)).toBe("caf\u00E9");
        } finally {
            ee.close();
        }
        // Classic (no EE marker in the KEY): the same high byte reads as windows-1252 by default...
        const classic = openGame(makeGameDir({ "dialog.tlk": buildTlk([Uint8Array.from([0xe9])]) }));
        try {
            expect(classic.tlk()?.get(0)).toBe("\u00E9");
        } finally {
            classic.close();
        }
        // ...but an explicit codepage wins for a non-Western classic install (Russian cp1251).
        const ru = openGame(makeGameDir({ "dialog.tlk": buildTlk([Uint8Array.from([0xc0])]) }), {
            encoding: "windows-1251",
        });
        try {
            expect(ru.tlk()?.get(0)).toBe("\u0410"); // Cyrillic A, not the cp1252 A-grave
        } finally {
            ru.close();
        }
    });

    it("opens the female dialogF.tlk separately from the male dialog.tlk", () => {
        const game = openGame(
            makeGameDir({ "dialog.tlk": buildTlk(["he says"]), "dialogF.tlk": buildTlk(["she says"]) }),
        );
        try {
            expect(game.tlk()?.get(0)).toBe("he says"); // male / default
            expect(game.tlk("female")?.get(0)).toBe("she says");
        } finally {
            game.close();
        }
    });

    it("exposes the detected game identity", () => {
        const game = openGame(makeGameDir({}, eeMarker)); // OH1000.ARE -> BG:EE
        try {
            expect(game.identity.variant).toBe("bgee");
            expect(game.identity.label).toBe("Baldur's Gate: Enhanced Edition");
        } finally {
            game.close();
        }
    });

    it("throws when chitin.key is absent", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgforge-key-bif-empty-"));
        tmpDirs.push(dir);
        expect(() => openGame(dir)).toThrow(/chitin\.key not found/);
    });
});
