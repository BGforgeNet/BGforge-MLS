/**
 * Named-bit dict projection for PRO flag fields.
 *
 * Exercises the canonical-doc shape (zod schema accepts dict, rejects raw int),
 * the strict-disjoint invariant (`_bits` overlapping a named bit fails to
 * load), and the reservoir-adaptation property (a snapshot with unnamed bits
 * in `_bits` round-trips byte-identically through parse → serialize).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { proCanonicalDocumentSchema, proCanonicalDocumentSchemaPermissive } from "../src/pro/canonical-schemas";
import { proParser } from "../src/pro";
import { flagDictToInt, intToFlagDict } from "../src/spec/coded-projection";
import { HeaderFlags } from "../src/pro/types";

const FIXTURES = path.resolve("client/testFixture/proto");

const validFlags = (overrides: Record<string, boolean | string> = {}) => ({
    flat: false,
    noBlock: false,
    multiHex: false,
    noHighlight: false,
    transRed: false,
    transNone: false,
    transWall: false,
    transGlass: false,
    transSteam: false,
    transEnergy: false,
    wallTransEnd: false,
    lightThru: false,
    shootThru: false,
    ...overrides,
});

const validBase = (flagOverrides: Record<string, boolean | string> = {}) => ({
    header: {
        objectType: 5,
        objectId: 0,
        textId: 0,
        frmType: 5,
        frmId: 0,
        lightRadius: 0,
        lightIntensity: 0,
        flags: validFlags(flagOverrides),
    },
    sections: { miscProperties: { unknown: 0 } },
});

describe("PRO header.flags — named-bit dict shape", () => {
    it("accepts a dict with all named keys boolean and no _bits", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase())).not.toThrow();
    });

    it("rejects a raw integer for the flags field", () => {
        const doc = validBase();
        (doc.header as Record<string, unknown>).flags = 0x20000000;
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects a dict missing one of the named keys", () => {
        const doc = validBase();
        const flags = { ...doc.header.flags } as Record<string, boolean | string>;
        delete flags.lightThru;
        (doc.header as Record<string, unknown>).flags = flags;
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects a dict with an extra unknown key (z.strictObject)", () => {
        const doc = validBase({ unknownExtra: true });
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("accepts an optional _bits hex string within the codec width", () => {
        // u32 codec: any 8-digit hex value is shape-valid (disjointness check
        // fires at the wire boundary, not in the schema).
        expect(() => proCanonicalDocumentSchema.parse(validBase({ _bits: "0x000000" }))).not.toThrow();
    });

    it("rejects malformed _bits strings", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase({ _bits: "deadbeef" }))).toThrow();
        expect(() => proCanonicalDocumentSchema.parse(validBase({ _bits: "0xZZZZ" }))).toThrow();
    });
});

describe("PRO header.flags — round-trip via parser", () => {
    // Skips when run from binary/ with no fixture symlink; pnpm test
    // orchestrator runs from workspace root where `client/testFixture/...`
    // resolves correctly.
    const fixtures = ["misc/00000001.pro", "critters/00000053.pro"]
        .map((rel) => ({ rel, abs: path.join(FIXTURES, rel) }))
        .filter(({ abs }) => fs.existsSync(abs));

    if (fixtures.length === 0) {
        it.skip("(no fixtures available — skipping)", () => {});
        return;
    }

    it.each(fixtures)("$rel round-trips byte-identically through the parser", ({ abs }) => {
        const input = new Uint8Array(fs.readFileSync(abs));
        const parsed = proParser.parse(input);
        expect(parsed.errors).toBeUndefined();
        const out = proParser.serialize!(parsed);
        expect(Buffer.from(out).equals(Buffer.from(input))).toBe(true);
    });
});

describe("PRO header.flags — strict-disjoint invariant at the wire boundary", () => {
    it("rejects writing a dict whose _bits overlaps a named bit", () => {
        // `lightThru` is bit 0x20000000 in HeaderFlags; the wire codec rejects
        // a dict that sets `_bits: "0x20000000"` because it duplicates the
        // named bit at the wire level. Permissive zod accepts it (shape-only);
        // the disjoint check fires when the doc is written to bytes.
        const overlap = validBase({ _bits: "0x20000000" });
        const validated = proCanonicalDocumentSchemaPermissive.parse(overlap);
        // proParser.serialize via canonical-writer eventually invokes
        // headerSchema.write → flagDictToInt → throws on the overlap.
        // We exercise flagDictToInt directly to keep the test focused.
        expect(() => flagDictToInt(HeaderFlags, validated.header.flags as Record<string, boolean | string>)).toThrow(
            /overlaps named-bit mask/,
        );
    });

    it("packs the dict back to the same int through intToFlagDict ↔ flagDictToInt", () => {
        // 0x20000000 lightThru + 0x00004000 transRed (per pro/types.ts).
        const original = 0x20004000;
        const dict = intToFlagDict(HeaderFlags, original, 32);
        expect(dict.lightThru).toBe(true);
        expect(dict.transRed).toBe(true);
        expect(dict.shootThru).toBe(false);
        expect(flagDictToInt(HeaderFlags, dict)).toBe(original);
    });

    it("preserves bits outside HeaderFlags via `_bits` reservoir", () => {
        // Bit 0x00000001 isn't named in HeaderFlags; the projection captures
        // it in `_bits` and the round-trip preserves it.
        const original = 0x20000001 >>> 0;
        const dict = intToFlagDict(HeaderFlags, original, 32);
        expect(dict._bits).toBe("0x1");
        expect(flagDictToInt(HeaderFlags, dict)).toBe(original);
    });
});
