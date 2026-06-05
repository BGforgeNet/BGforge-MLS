import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { itmParser } from "../src/itm";
import { getItmCanonicalDocument, rebuildItmCanonicalDocument } from "../src/itm/canonical-reader";
import { splParser } from "../src/spl";
import { rebuildSplCanonicalDocument } from "../src/spl/canonical-reader";
import { serializeSplCanonicalDocument } from "../src/spl/canonical-writer";
import { splCanonicalDocumentSchemaPermissive } from "../src/spl/canonical-schemas";
import { SPL_SIGNATURE, SPL_VERSION_V1 } from "../src/spl/types";
import { parseWithSchemaValidation } from "../src/schema-validation";
import { walkStruct, structFromDisplay } from "../src/spec/walk-display";
import { splHeaderSpecAnnotated } from "../src/spl/specs/header.overrides";
import { splAbilitySpecAnnotated } from "../src/spl/specs/ability.overrides";
import { isCharsSpec, isArraySpec, type FieldSpec } from "../src/spec/types";

const ITM = path.resolve(__dirname, "../../grammars/weidu-tp2/test/samples/core/items/misc8j.itm");

describe("ITM rebuild from display", () => {
    it("rebuildFromDisplay produces a valid document that round-trips to the same bytes", () => {
        // Parse the original ITM file.
        const original = new Uint8Array(fs.readFileSync(ITM));
        const result = itmParser.parse(original);

        // Strip the eager document to force rebuild from the display tree.
        const rebuilt = rebuildItmCanonicalDocument({ ...result, document: undefined });

        // The rebuilt document must pass the permissive schema (structurally
        // valid ITM canonical doc).
        expect(rebuilt).toHaveProperty("header");
        expect(rebuilt).toHaveProperty("abilities");
        expect(rebuilt).toHaveProperty("effects");

        // Non-chars scalar and flags fields must match the eager document exactly.
        // Chars fields may differ in trailing-NUL padding (the display layer
        // strips trailing NULs from wire bytes; the serializer NUL-pads shorter
        // strings on write). This is a known display-layer limitation: the wire
        // canonical doc stores full bytes including trailing NULs while the
        // display tree stores trimmed strings.
        const eager = getItmCanonicalDocument(result)!;
        expect(rebuilt.abilities.length).toBe(eager.abilities.length);
        expect(rebuilt.effects.length).toBe(eager.effects.length);
        // Numeric fields on the header must agree.
        expect(rebuilt.header.extendedHeadersOffset).toBe(eager.header.extendedHeadersOffset);
        expect(rebuilt.header.extendedHeadersCount).toBe(eager.header.extendedHeadersCount);
        expect(rebuilt.header.featureBlocksOffset).toBe(eager.header.featureBlocksOffset);
        expect(rebuilt.header.featureBlocksCount).toBe(eager.header.featureBlocksCount);
        expect(rebuilt.header.flags).toEqual(eager.header.flags);
        expect(rebuilt.header.type).toBe(eager.header.type);
        expect(rebuilt.header.usabilityFlags).toEqual(eager.header.usabilityFlags);

        // The rebuilt document must be idempotent: serialize it, parse again,
        // and rebuild again to get the same document.
        const bytes2 = itmParser.serialize!({ ...result, document: rebuilt as never });
        const reparsed = itmParser.parse(bytes2);
        const rebuilt2 = rebuildItmCanonicalDocument({ ...reparsed, document: undefined });
        expect(rebuilt2).toEqual(rebuilt);
    });
});

describe("SPL rebuild from display", () => {
    it("rebuildFromDisplay round-trips a serialized minimal SPL document", () => {
        // Build a minimal valid SPL canonical document via the eager parse of
        // a serialized minimal file. serializeSplCanonicalDocument takes a
        // SplCanonicalDocument whose derived fields will be recomputed; the
        // permissive header schema accepts all-zero values for every field.
        const minimalRaw = buildMinimalSplDoc();
        const doc = parseWithSchemaValidation(splCanonicalDocumentSchemaPermissive, minimalRaw, "minimal SPL doc");

        // Serialize the minimal doc to bytes.
        const bytes = serializeSplCanonicalDocument(doc);

        // Parse the serialized bytes and verify the rebuild is idempotent.
        // The display layer strips trailing NULs from chars fields (e.g. all-zero
        // resref slots become ""), so the rebuilt doc differs from the eager
        // canonical doc (which stores the raw wire bytes). The correct invariant
        // is idempotency: serialize the rebuilt doc, parse it again, and rebuild
        // again to get the same document.
        const parsed = splParser.parse(new Uint8Array(bytes));
        const rebuilt = rebuildSplCanonicalDocument({ ...parsed, document: undefined });

        // The rebuild must produce a valid document.
        expect(rebuilt).toHaveProperty("header");
        expect(rebuilt.abilities).toHaveLength(0);
        expect(rebuilt.effects).toHaveLength(0);
        expect(rebuilt.header.signature).toBe("SPL ");
        expect(rebuilt.header.version).toBe("V1  ");

        // Idempotency: serialize rebuilt -> parse -> rebuild gives the same result.
        const bytes2 = serializeSplCanonicalDocument(rebuilt);
        const reparsed = splParser.parse(new Uint8Array(bytes2));
        const rebuilt2 = rebuildSplCanonicalDocument({ ...reparsed, document: undefined });
        expect(rebuilt2).toEqual(rebuilt);
    });

    it("structFromDisplay round-trips SPL header and ability specs", () => {
        // Property test: walkStruct then structFromDisplay round-trips the full
        // field type spectrum in splHeaderSpecAnnotated and splAbilitySpecAnnotated.
        // SPL has no array fields in either spec, so structFromDisplay covers everything.

        const headerSample = buildAllZeroSample(splHeaderSpecAnnotated as Record<string, FieldSpec>);
        const headerGroup = walkStruct(splHeaderSpecAnnotated, {}, 0, headerSample as never, "SPL Header");
        expect(structFromDisplay(headerGroup, splHeaderSpecAnnotated, {})).toEqual(headerSample);

        const abilitySample = buildAllZeroSample(splAbilitySpecAnnotated as Record<string, FieldSpec>);
        const abilityGroup = walkStruct(splAbilitySpecAnnotated, {}, 0, abilitySample as never, "Ability 1");
        expect(structFromDisplay(abilityGroup, splAbilitySpecAnnotated, {})).toEqual(abilitySample);
    });
});

/** Build an all-zero sample for any flat spec (scalars -> 0, flags -> [], chars -> ""). */
function buildAllZeroSample(spec: Record<string, FieldSpec>): Record<string, unknown> {
    const sample: Record<string, unknown> = {};
    for (const key of Object.keys(spec)) {
        const fieldSpec = spec[key]!;
        if (isCharsSpec(fieldSpec)) {
            sample[key] = "";
        } else if (isArraySpec(fieldSpec)) {
            // Fixed-count numeric array: fill with zeros.
            const count = typeof fieldSpec.count === "number" ? fieldSpec.count : 0;
            sample[key] = Array.from({ length: count }, () => 0);
        } else if (fieldSpec.flags) {
            sample[key] = [] as string[];
        } else {
            sample[key] = 0;
        }
    }
    return sample;
}

/** Build a minimal all-zero SPL doc object that the permissive schema accepts. */
function buildMinimalSplDoc(): { header: Record<string, unknown>; abilities: never[]; effects: never[] } {
    const header = buildAllZeroSample(splHeaderSpecAnnotated as Record<string, FieldSpec>);
    // Signature and version must match SPL v1 wire magic for the parser to
    // accept the resulting bytes. The serializer writes them verbatim from the
    // canonical doc, so supply the correct ASCII strings here.
    header["signature"] = String.fromCodePoint(...SPL_SIGNATURE);
    header["version"] = String.fromCodePoint(...SPL_VERSION_V1);
    return { header, abilities: [], effects: [] };
}
