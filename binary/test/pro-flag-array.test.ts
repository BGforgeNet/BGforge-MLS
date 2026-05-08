/**
 * Sorted-array projection for PRO flag fields.
 *
 * Exercises the canonical-doc shape (zod schema accepts {flags, flagsRaw?},
 * rejects raw int and dict), the strict-disjoint invariant (`flagsRaw`
 * overlapping a named bit fails to load), and the reservoir-adaptation
 * property (a snapshot with unnamed bits in `flagsRaw` round-trips
 * byte-identically through parse → serialize).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { proCanonicalDocumentSchema, proCanonicalDocumentSchemaPermissive } from "../src/pro/canonical-schemas";
import { proParser } from "../src/pro";
import { flagArrayToInt, intToFlagArray } from "../src/spec/coded-projection";
import { HeaderFlags } from "../src/pro/types";

const FIXTURES = path.resolve("client/testFixture/proto");

const validFlags = (overrides: Partial<{ flags: string[]; flagsRaw: string }> = {}) => ({
    flags: [],
    ...overrides,
});

const validBase = (flagOverrides: Partial<{ flags: string[]; flagsRaw: string }> = {}) => ({
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

describe("PRO header.flags — sorted-array shape", () => {
    it("accepts an empty flags array with no flagsRaw", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase())).not.toThrow();
    });

    it("accepts known names and no flagsRaw", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flags: ["lightThru"] }))).not.toThrow();
    });

    it("rejects a raw integer for the flags field", () => {
        const doc = validBase();
        (doc.header as Record<string, unknown>).flags = 0x20000000;
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects a dict shape (legacy)", () => {
        const doc = validBase();
        (doc.header as Record<string, unknown>).flags = { lightThru: true };
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects an unknown flag name", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flags: ["unknownFlag"] }))).toThrow();
    });

    it("rejects duplicate names in the flags array", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flags: ["lightThru", "lightThru"] }))).toThrow();
    });

    it("rejects an extra unknown sibling key (z.strictObject)", () => {
        const doc = validBase();
        (doc.header.flags as Record<string, unknown>).bogus = true;
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("accepts an optional flagsRaw hex string within the codec width", () => {
        // u32 codec: any 1–8 digit hex value is shape-valid (disjointness check
        // fires at the wire boundary, not in the schema).
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flagsRaw: "0x000000" }))).not.toThrow();
    });

    it("rejects malformed flagsRaw strings", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flagsRaw: "deadbeef" }))).toThrow();
        expect(() => proCanonicalDocumentSchema.parse(validBase({ flagsRaw: "0xZZZZ" }))).toThrow();
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
    it("rejects writing a projection whose flagsRaw overlaps a named bit", () => {
        // `lightThru` is bit 0x20000000 in HeaderFlags; the wire codec rejects
        // a projection that sets `flagsRaw: "0x20000000"` because it duplicates
        // the named bit at the wire level. Permissive zod accepts it
        // (shape-only); the disjoint check fires when the doc is written to
        // bytes.
        const overlap = validBase({ flagsRaw: "0x20000000" });
        const validated = proCanonicalDocumentSchemaPermissive.parse(overlap);
        expect(() =>
            flagArrayToInt(HeaderFlags, validated.header.flags as { flags: string[]; flagsRaw?: string }),
        ).toThrow(/overlaps named-bit mask/);
    });

    it("packs the array back to the same int through intToFlagArray ↔ flagArrayToInt", () => {
        // 0x20000000 lightThru + 0x00004000 transRed (per pro/types.ts).
        const original = 0x20004000;
        const projection = intToFlagArray(HeaderFlags, original, 32);
        expect(projection.flags).toContain("lightThru");
        expect(projection.flags).toContain("transRed");
        expect(projection.flags).not.toContain("shootThru");
        expect(flagArrayToInt(HeaderFlags, projection)).toBe(original);
    });

    it("preserves bits outside HeaderFlags via `flagsRaw` reservoir", () => {
        // Bit 0x00000001 isn't named in HeaderFlags; the projection captures
        // it in `flagsRaw` and the round-trip preserves it.
        const original = 0x20000001 >>> 0;
        const projection = intToFlagArray(HeaderFlags, original, 32);
        expect(projection.flagsRaw).toBe("0x1");
        expect(flagArrayToInt(HeaderFlags, projection)).toBe(original);
    });
});
