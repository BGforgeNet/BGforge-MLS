import { describe, expect, test } from "vitest";
import { itmPresentationSchema } from "../src/itm/presentation-schema";
import { itmCanonicalDocumentSchema } from "../src/itm/canonical-schemas";
import { ITM_HEADER_SIZE, ItmFlags } from "../src/itm/types";
import { intToFlagArray } from "../src/spec/coded-projection";

describe("ITM canonical-doc strict schema rejects mismatched derived fields", () => {
    function makeValidDoc() {
        // Minimum-size doc that would survive each refinement: header pointers
        // line up with zero abilities and zero effects.
        return {
            header: {
                signature: "ITM ",
                version: "V1  ",
                unidentifiedName: 0,
                identifiedName: 0,
                replacement: "\0\0\0\0\0\0\0\0",
                flags: intToFlagArray(ItmFlags, 0, 32),
                type: 0,
                usabilityFlags: [0, 0, 0, 0],
                animation: "  ",
                minLevel: 0,
                minStrength: 0,
                minStrengthBonus: 0,
                kitUsability1: 0,
                minIntelligence: 0,
                kitUsability2: 0,
                minDexterity: 0,
                kitUsability3: 0,
                minWisdom: 0,
                kitUsability4: 0,
                minConstitution: 0,
                weaponProficiency: 0,
                minCharisma: 0,
                price: 0,
                stackAmount: 1,
                inventoryIcon: "\0\0\0\0\0\0\0\0",
                loreToId: 0,
                groundIcon: "\0\0\0\0\0\0\0\0",
                weight: 0,
                unidentifiedDesc: 0,
                identifiedDesc: 0,
                descriptionIcon: "\0\0\0\0\0\0\0\0",
                enchantment: 0,
                extendedHeadersOffset: ITM_HEADER_SIZE,
                extendedHeadersCount: 0,
                featureBlocksOffset: ITM_HEADER_SIZE,
                featureBlocksIndex: 0,
                featureBlocksCount: 0,
            },
            abilities: [],
            effects: [],
        };
    }

    test("accepts a doc whose derived fields match the recomputed truth", () => {
        const result = itmCanonicalDocumentSchema.safeParse(makeValidDoc());
        expect(result.success).toBe(true);
    });

    test("rejects a doc whose extendedHeadersOffset disagrees with the writer-recompute", () => {
        const doc = makeValidDoc();
        doc.header.extendedHeadersOffset = 99999;
        const result = itmCanonicalDocumentSchema.safeParse(doc);
        expect(result.success).toBe(false);
        const issuePaths = !result.success ? result.error.issues.map((i) => i.path.join(".")) : [];
        expect(issuePaths).toContain("header.extendedHeadersOffset");
    });

    test("rejects a doc whose extendedHeadersCount disagrees with abilities.length", () => {
        const doc = makeValidDoc();
        doc.header.extendedHeadersCount = 5;
        const result = itmCanonicalDocumentSchema.safeParse(doc);
        expect(result.success).toBe(false);
    });
});

describe("ITM derived (structural) fields are locked from editing", () => {
    const entries = itmPresentationSchema.exactFields;

    test.each([
        "itm.header.extendedHeadersOffset",
        "itm.header.extendedHeadersCount",
        "itm.header.featureBlocksOffset",
        "itm.header.featureBlocksIndex",
        "itm.header.featureBlocksCount",
    ])("%s carries editable: false", (key) => {
        expect(entries[key]).toMatchObject({ editable: false });
    });

    test.each(["itm.abilities[].featureBlockCount", "itm.abilities[].featureBlockIndex"])(
        "%s carries editable: false",
        (key) => {
            expect(entries[key]).toMatchObject({ editable: false });
        },
    );
});
