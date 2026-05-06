import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import "../src"; // side-effect: register all parsers and adapters
import { formatAdapterRegistry } from "../src/format-adapter";
import { itmParser } from "../src/itm";
import { createCanonicalItmJsonSnapshot, loadCanonicalItmJsonSnapshot } from "../src/itm/json-snapshot";
import { splParser } from "../src/spl";
import { createCanonicalSplJsonSnapshot, loadCanonicalSplJsonSnapshot } from "../src/spl/json-snapshot";

const itmFormatAdapter = formatAdapterRegistry.get("itm")!;
const splFormatAdapter = formatAdapterRegistry.get("spl")!;

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ITM_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const SPL_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl");

describe("ITM canonical snapshot round-trip", () => {
    test("createCanonical → loadCanonical produces byte-identical output", () => {
        const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
        const result = itmParser.parse(bytes);
        const json = createCanonicalItmJsonSnapshot(result);
        const loaded = loadCanonicalItmJsonSnapshot(json);
        expect([...loaded.bytes]).toEqual([...bytes]);
        expect(loaded.snapshot.format).toBe("itm");
    });

    test("itmFormatAdapter routes the snapshot through createJsonSnapshot/loadJsonSnapshot", () => {
        const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
        const result = itmParser.parse(bytes);
        const json = itmFormatAdapter.createJsonSnapshot(result);
        const loaded = itmFormatAdapter.loadJsonSnapshot(json);
        expect(loaded.bytes).toBeDefined();
        expect([...loaded.bytes!]).toEqual([...bytes]);
    });

    test("rebuildCanonicalDocument echoes the parser's canonical document", () => {
        const bytes = new Uint8Array(fs.readFileSync(ITM_FIXTURE));
        const result = itmParser.parse(bytes);
        const doc = itmFormatAdapter.rebuildCanonicalDocument(result);
        expect(doc).toBeDefined();
    });

    test.each<[readonly string[], string | undefined]>([
        [["ITM Header", "Flags"], "itm.header.flags"],
        [["Abilities", "Ability 1", "Range"], "itm.abilities[].range"],
        [["Effects", "Effect 1", "Opcode"], "itm.effects[].opcode"],
        [["Other"], "itm.other"],
        [[], undefined],
    ])("itmFormatAdapter.toSemanticFieldKey %j → %j", (segments, expected) => {
        expect(itmFormatAdapter.toSemanticFieldKey(segments)).toBe(expected);
    });
});

describe("SPL canonical snapshot round-trip", () => {
    test("createCanonical → loadCanonical produces byte-identical output", () => {
        const bytes = new Uint8Array(fs.readFileSync(SPL_FIXTURE));
        const result = splParser.parse(bytes);
        const json = createCanonicalSplJsonSnapshot(result);
        const loaded = loadCanonicalSplJsonSnapshot(json);
        expect([...loaded.bytes]).toEqual([...bytes]);
        expect(loaded.snapshot.format).toBe("spl");
    });

    test("splFormatAdapter routes the snapshot through createJsonSnapshot/loadJsonSnapshot", () => {
        const bytes = new Uint8Array(fs.readFileSync(SPL_FIXTURE));
        const result = splParser.parse(bytes);
        const json = splFormatAdapter.createJsonSnapshot(result);
        const loaded = splFormatAdapter.loadJsonSnapshot(json);
        expect(loaded.bytes).toBeDefined();
        expect([...loaded.bytes!]).toEqual([...bytes]);
    });

    test("rebuildCanonicalDocument echoes the parser's canonical document", () => {
        const bytes = new Uint8Array(fs.readFileSync(SPL_FIXTURE));
        const result = splParser.parse(bytes);
        const doc = splFormatAdapter.rebuildCanonicalDocument(result);
        expect(doc).toBeDefined();
    });

    test.each<[readonly string[], string | undefined]>([
        [["SPL Header", "Flags"], "spl.header.flags"],
        [["Abilities", "Ability 1", "Range"], "spl.abilities[].range"],
        [["Effects", "Effect 1", "Opcode"], "spl.effects[].opcode"],
        [["Other"], "spl.other"],
        [[], undefined],
    ])("splFormatAdapter.toSemanticFieldKey %j → %j", (segments, expected) => {
        expect(splFormatAdapter.toSemanticFieldKey(segments)).toBe(expected);
    });
});

describe("ITM/SPL parser error paths", () => {
    test("ITM rejects non-ITM signature", () => {
        const bytes = new Uint8Array(0x72);
        const result = itmParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/signature/i);
    });

    test("ITM rejects too-small input", () => {
        const result = itmParser.parse(new Uint8Array(4));
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/too small/i);
    });

    test("SPL rejects non-SPL signature", () => {
        const bytes = new Uint8Array(0x72);
        const result = splParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/signature/i);
    });

    test("SPL rejects too-small input", () => {
        const result = splParser.parse(new Uint8Array(4));
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/too small/i);
    });
});

/**
 * Forge a minimal-but-valid ITM file so that header-level corruption can be
 * tested in isolation. Returns a 0x72-byte buffer with signature/version set
 * and the requested header fields written; everything else is zero.
 */
function forgeItmHeader(overrides: {
    extendedHeadersOffset?: number;
    extendedHeadersCount?: number;
    featureBlocksOffset?: number;
}): Uint8Array {
    const bytes = new Uint8Array(0x72);
    bytes.set([0x49, 0x54, 0x4d, 0x20], 0); // "ITM "
    bytes.set([0x56, 0x31, 0x20, 0x20], 4); // "V1  "
    const dv = new DataView(bytes.buffer);
    if (overrides.extendedHeadersOffset !== undefined) dv.setUint32(0x64, overrides.extendedHeadersOffset, true);
    if (overrides.extendedHeadersCount !== undefined) dv.setUint16(0x68, overrides.extendedHeadersCount, true);
    if (overrides.featureBlocksOffset !== undefined) dv.setUint32(0x6a, overrides.featureBlocksOffset, true);
    return bytes;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
    const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
    const out = new Uint8Array(total);
    let pos = 0;
    for (const p of parts) {
        out.set(p, pos);
        pos += p.byteLength;
    }
    return out;
}

describe("ITM corruption handling", () => {
    test("rejects header.extendedHeadersCount that runs past EOF", () => {
        // Header declares 1000 abilities at offset 0x72; file is only 0x72 bytes.
        const bytes = forgeItmHeader({
            extendedHeadersOffset: 0x72,
            extendedHeadersCount: 1000,
            featureBlocksOffset: 0x72,
        });
        const result = itmParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/abilities extend past eof/i);
    });

    test("rejects effects region misaligned to EFFECT_SIZE", () => {
        // featureBlocksOffset = 0x72; trailing payload is 0x10 bytes (not a
        // multiple of 0x30) so the effects region cannot be cleanly carved.
        const header = forgeItmHeader({
            extendedHeadersOffset: 0x72,
            extendedHeadersCount: 0,
            featureBlocksOffset: 0x72,
        });
        const bytes = concatBytes(header, new Uint8Array(0x10));
        const result = itmParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/misaligned/i);
    });

    test("rejects featureBlocksOffset past EOF", () => {
        // featureBlocksOffset = 0xff_ff_ff_ff (huge) → effectsBytes goes negative.
        const bytes = forgeItmHeader({
            extendedHeadersOffset: 0x72,
            extendedHeadersCount: 0,
            featureBlocksOffset: 0xff_ff_ff_ff,
        });
        const result = itmParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/misaligned/i);
    });
});

function forgeSplHeader(overrides: {
    extendedHeadersOffset?: number;
    extendedHeadersCount?: number;
    featureBlocksOffset?: number;
}): Uint8Array {
    const bytes = new Uint8Array(0x72);
    bytes.set([0x53, 0x50, 0x4c, 0x20], 0); // "SPL "
    bytes.set([0x56, 0x31, 0x20, 0x20], 4); // "V1  "
    const dv = new DataView(bytes.buffer);
    if (overrides.extendedHeadersOffset !== undefined) dv.setUint32(0x64, overrides.extendedHeadersOffset, true);
    if (overrides.extendedHeadersCount !== undefined) dv.setUint16(0x68, overrides.extendedHeadersCount, true);
    if (overrides.featureBlocksOffset !== undefined) dv.setUint32(0x6a, overrides.featureBlocksOffset, true);
    return bytes;
}

describe("SPL corruption handling", () => {
    test("rejects header.extendedHeadersCount that runs past EOF", () => {
        const bytes = forgeSplHeader({
            extendedHeadersOffset: 0x72,
            extendedHeadersCount: 1000,
            featureBlocksOffset: 0x72,
        });
        const result = splParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/abilities extend past eof/i);
    });

    test("rejects effects region misaligned to EFFECT_SIZE", () => {
        const header = forgeSplHeader({
            extendedHeadersOffset: 0x72,
            extendedHeadersCount: 0,
            featureBlocksOffset: 0x72,
        });
        const bytes = concatBytes(header, new Uint8Array(0x10));
        const result = splParser.parse(bytes);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toMatch(/misaligned/i);
    });
});
