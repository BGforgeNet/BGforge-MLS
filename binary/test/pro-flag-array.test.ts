/**
 * Flat-array projection for PRO flag fields.
 *
 * Exercises the canonical-doc shape (zod schema accepts a sorted `string[]`,
 * rejects raw int and wrapper-object), the strict-disjoint invariant
 * (`bit<N>` overlapping a named bit fails to load), and the reservoir
 * property (a snapshot with unnamed `bit<N>` entries round-trips
 * byte-identically through parse -> serialize).
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { proCanonicalDocumentSchema, proCanonicalDocumentSchemaPermissive } from "../src/pro/canonical-schemas";
import { proParser } from "../src/pro";
import { flagArrayToInt, intToFlagArray } from "../src/spec/coded-projection";
import { HeaderFlags } from "../src/pro/types";

const FIXTURES = path.resolve("client/testFixture/proto");

const validBase = (flags: string[] = []) => ({
    header: {
        objectType: 5,
        objectId: 0,
        textId: 0,
        frmType: 5,
        frmId: 0,
        lightRadius: 0,
        lightIntensity: 0,
        flags,
    },
    sections: { miscProperties: { unknown: 0 } },
});

describe("PRO header.flags - flat-array shape", () => {
    it("accepts an empty array", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase())).not.toThrow();
    });

    it("accepts known names", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase(["lightThru"]))).not.toThrow();
    });

    it("rejects a raw integer for the flags field", () => {
        const doc = validBase();
        (doc.header as Record<string, unknown>).flags = 0x20000000;
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects a wrapper-object shape (legacy)", () => {
        const doc = validBase();
        (doc.header as Record<string, unknown>).flags = { flags: ["lightThru"] };
        expect(() => proCanonicalDocumentSchema.parse(doc)).toThrow();
    });

    it("rejects an unknown flag name", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase(["unknownFlag"]))).toThrow();
    });

    it("rejects duplicate entries", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase(["lightThru", "lightThru"]))).toThrow();
    });

    it("accepts bit<N> for unnamed positions within the codec width", () => {
        // HeaderFlags is u32; bits not in the table are valid as `bit<N>`.
        expect(() => proCanonicalDocumentSchema.parse(validBase(["bit0"]))).not.toThrow();
    });

    it("rejects bit<N> with N >= codec width", () => {
        expect(() => proCanonicalDocumentSchema.parse(validBase(["bit32"]))).toThrow();
    });

    it("rejects bit<N> overlapping a named-bit position", () => {
        // 0x20000000 == bit 29, named `lightThru`; the literal "bit29" must use the slug.
        expect(() => proCanonicalDocumentSchema.parse(validBase(["bit29"]))).toThrow();
    });
});

describe("PRO header.flags - round-trip via parser", () => {
    // Skips when run from binary/ with no fixture symlink; pnpm test
    // orchestrator runs from workspace root where `client/testFixture/...`
    // resolves correctly.
    const fixtures = ["misc/00000001.pro", "critters/00000053.pro"]
        .map((rel) => ({ rel, abs: path.join(FIXTURES, rel) }))
        .filter(({ abs }) => fs.existsSync(abs));

    if (fixtures.length === 0) {
        it.skip("(no fixtures available - skipping)", () => {});
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

describe("PRO header.flags - strict-disjoint invariant at the wire boundary", () => {
    it("rejects writing a projection that includes a bit<N> overlapping a named bit", () => {
        // `lightThru` is bit 0x20000000 == position 29 in HeaderFlags. The
        // permissive zod schema rejects "bit29" at the schema layer (overlap
        // is shape-checked there too); flagArrayToInt re-checks at the wire
        // boundary as a defence-in-depth gate.
        expect(() => flagArrayToInt(HeaderFlags, ["bit29"], 32)).toThrow(/overlaps named-bit mask/);
        // The schema layer rejects the same input via its element refine,
        // so a permissive parse never produces a `["bit29"]` value here -
        // assert the schema gate fires on the doc form too.
        const overlapDoc = validBase(["bit29"]);
        expect(() => proCanonicalDocumentSchemaPermissive.parse(overlapDoc)).toThrow();
    });

    it("packs the array back to the same int through intToFlagArray <-> flagArrayToInt", () => {
        // 0x20000000 lightThru + 0x00004000 transRed (per pro/types.ts).
        const original = 0x20004000;
        const projection = intToFlagArray(HeaderFlags, original, 32);
        expect(projection).toContain("lightThru");
        expect(projection).toContain("transRed");
        expect(projection).not.toContain("shootThru");
        expect(flagArrayToInt(HeaderFlags, projection, 32)).toBe(original);
    });

    it("preserves bits outside HeaderFlags via bit<N> entries", () => {
        // Bit 0 isn't named in HeaderFlags; the projection emits "bit0" and
        // the round-trip preserves it.
        const original = 0x20000001 >>> 0;
        const projection = intToFlagArray(HeaderFlags, original, 32);
        expect(projection).toContain("bit0");
        expect(flagArrayToInt(HeaderFlags, projection, 32)).toBe(original);
    });
});
