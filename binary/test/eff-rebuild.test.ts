/**
 * EFF rebuild-from-display tests.
 *
 * EFF v2 has no abilities or effects arrays - just a header (8 bytes) and a
 * body (264 bytes). The body contains one plain padding array (`unused7`,
 * 15 x u32) whose values are discarded by the display layer; the rebuild
 * zero-fills that field.
 *
 * Four invariants verified:
 *   1. Byte round-trip: rebuild -> serialize equals eager -> serialize.
 *   2. structFromDisplay property: walkStruct + structFromDisplay is the
 *      identity for EFF header and body specs.
 *   3. Edit-survives: mutating a display field (body `opcode`) is reflected
 *      in the rebuilt document and round-trips to bytes.
 *   4. (Smoke) rebuildEffCanonicalDocument does not throw on a parsed result.
 */

import { describe, expect, it } from "vitest";
import { effParser } from "../src/eff";
import { rebuildEffCanonicalDocument } from "../src/eff/canonical-reader";
import { serializeEffCanonicalDocument } from "../src/eff/canonical-writer";
import { effCanonicalDocumentSchemaPermissive } from "../src/eff/canonical-schemas";
import { EFF_SIGNATURE, EFF_VERSION_V2 } from "../src/eff/types";
import { walkStruct, structFromDisplay } from "../src/spec/walk-display";
import { effHeaderSpec } from "../src/eff/specs/header";
import { effBodySpecAnnotated } from "../src/eff/specs/body.overrides";
import { isArraySpec, isCharsSpec, type FieldSpec } from "../src/spec/types";
import { parseWithSchemaValidation } from "../src/schema-validation";
import type { ParsedField, ParsedGroup } from "../src/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build an all-zero sample for a flat spec (scalars -> 0, flags -> [], chars -> "", arrays -> zero[count]). */
function buildAllZeroSample(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fs = spec[key]!;
        if (isCharsSpec(fs)) {
            sample[key] = "";
        } else if (isArraySpec(fs)) {
            const count = typeof fs.count === "number" ? fs.count : 0;
            sample[key] = Array.from({ length: count }, () => 0);
        } else if (fs.flags) {
            sample[key] = [] as string[];
        } else {
            sample[key] = 0;
        }
    }
    return sample;
}

/**
 * Build a minimal valid EFF v2 canonical document that the parser accepts.
 * All numeric fields are zero; chars fields carry the correct wire magic.
 * `unused7` (15 x u32 padding) and `variableName` (charsSpec 32) are zeroed.
 */
function buildMinimalEffDoc(): Record<string, unknown> {
    const header = buildAllZeroSample(effHeaderSpec as Record<string, FieldSpec>);
    header["signature"] = String.fromCodePoint(...EFF_SIGNATURE);
    header["version"] = String.fromCodePoint(...EFF_VERSION_V2);

    const body = buildAllZeroSample(effBodySpecAnnotated as Record<string, FieldSpec>);
    // body.signature2 + body.version2 carry the EFF wire magic in the body too.
    body["signature2"] = String.fromCodePoint(...EFF_SIGNATURE);
    body["version2"] = String.fromCodePoint(...EFF_VERSION_V2);

    return { header, body };
}

// ---------------------------------------------------------------------------
// Byte round-trip
// ---------------------------------------------------------------------------

describe("EFF rebuild - byte round-trip", () => {
    it("rebuild -> serialize produces the same bytes as eager -> serialize", () => {
        const minimalRaw = buildMinimalEffDoc();
        const doc = parseWithSchemaValidation(effCanonicalDocumentSchemaPermissive, minimalRaw, "minimal EFF doc");
        const bytes = serializeEffCanonicalDocument(doc);

        const parsed = effParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        // Eager path: serialize with result.document intact.
        const eagerBytes = effParser.serialize(parsed);

        // Rebuild path: strip document to force display-tree rebuild, then serialize.
        const rebuiltDoc = rebuildEffCanonicalDocument({ ...parsed, document: undefined });
        const rebuiltBytes = effParser.serialize({ ...parsed, document: rebuiltDoc });

        expect([...rebuiltBytes]).toEqual([...eagerBytes]);
    });
});

// ---------------------------------------------------------------------------
// structFromDisplay property test for EFF specs
// ---------------------------------------------------------------------------

describe("EFF structFromDisplay property", () => {
    it("walkStruct + structFromDisplay round-trips EFF header spec", () => {
        // EFF header is only signature + version (both charsSpec); structFromDisplay
        // handles chars fields directly.
        const sample = buildAllZeroSample(effHeaderSpec as Record<string, FieldSpec>);
        const g = walkStruct(effHeaderSpec, {}, 0, sample as never, "EFF Header");
        expect(structFromDisplay(g, effHeaderSpec, {})).toEqual(sample);
    });

    it("walkStruct + structFromDisplay round-trips EFF body spec for non-array fields", () => {
        // effBodySpecAnnotated overrides variableName to charsSpec(32) so the body
        // has no view:"slots" arrays, but does have unused7 (plain padding array).
        // structFromDisplay is tested here only for the scalar+chars subset; the full
        // rebuild (including unused7 zero-fill) is covered by the round-trip test above.
        const sample = buildAllZeroSample(effBodySpecAnnotated as Record<string, FieldSpec>);
        const g = walkStruct(effBodySpecAnnotated, {}, 0, sample as never, "EFF Body");

        // Build a scalar-only spec by stripping array fields; structFromDisplay
        // throws on array fields and we just need to confirm scalar+chars roundtrip.
        const scalarSpec: Record<string, FieldSpec> = {};
        for (const key of Object.keys(effBodySpecAnnotated as Record<string, FieldSpec>)) {
            const fs = (effBodySpecAnnotated as Record<string, FieldSpec>)[key]!;
            if (!isArraySpec(fs)) scalarSpec[key] = fs;
        }
        const scalarSample: Record<string, unknown> = {};
        for (const key of Object.keys(scalarSpec)) {
            scalarSample[key] = sample[key];
        }

        const fakeGroup: ParsedGroup = {
            name: g.name,
            fields: g.fields.filter((e): e is ParsedField => !("fields" in e)),
            expanded: true,
        };
        expect(structFromDisplay(fakeGroup, scalarSpec, {})).toEqual(scalarSample);
    });
});

// ---------------------------------------------------------------------------
// Edit-survives check
// ---------------------------------------------------------------------------

describe("EFF rebuild - edit survives", () => {
    it("mutating the display tree opcode field is reflected in the rebuilt document", () => {
        const minimalRaw = buildMinimalEffDoc();
        const doc = parseWithSchemaValidation(effCanonicalDocumentSchemaPermissive, minimalRaw, "minimal EFF doc");
        const bytes = serializeEffCanonicalDocument(doc);
        const parsed = effParser.parse(new Uint8Array(bytes));
        expect(parsed.errors).toBeUndefined();

        // Find the "EFF Body" group and edit the Opcode field.
        const root = parsed.root;
        const bodyGroup = root.fields.find((e): e is ParsedGroup => "fields" in e && e.name === "EFF Body");
        expect(bodyGroup).toBeDefined();

        // Clone root with the mutated body group (opcode rawValue set to 7).
        const editedBodyFields = bodyGroup!.fields.map((e) => {
            if (!("fields" in e) && e.name === "Opcode") {
                return { ...e, rawValue: 7, value: 7 };
            }
            return e;
        });
        const editedBody: ParsedGroup = { ...bodyGroup!, fields: editedBodyFields };
        const editedRoot: ParsedGroup = {
            ...root,
            fields: root.fields.map((e) => ("fields" in e && e.name === "EFF Body" ? editedBody : e)),
        };

        const editedResult = { ...parsed, root: editedRoot, document: undefined };
        const rebuilt = rebuildEffCanonicalDocument(editedResult);
        expect(rebuilt.body.opcode).toBe(7);

        // Serialize the rebuilt document and reparse to confirm bytes carry the edit.
        const editedBytes = serializeEffCanonicalDocument(rebuilt);
        const reparsed = effParser.parse(new Uint8Array(editedBytes));
        expect(reparsed.errors).toBeUndefined();
        const reparsedDoc = rebuildEffCanonicalDocument(reparsed);
        expect(reparsedDoc.body.opcode).toBe(7);
    });
});
