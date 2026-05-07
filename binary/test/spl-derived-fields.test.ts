import { describe, expect, test } from "vitest";
import { splPresentationSchema } from "../src/spl/presentation-schema";

describe("SPL derived (structural) fields are locked from editing", () => {
    const entries = splPresentationSchema.exactFields;

    test.each([
        "spl.header.extendedHeadersOffset",
        "spl.header.extendedHeadersCount",
        "spl.header.featureBlocksOffset",
        "spl.header.castingFeatureBlocksOffset",
        "spl.header.castingFeatureBlocksCount",
    ])("%s carries editable: false", (key) => {
        expect(entries[key]).toMatchObject({ editable: false });
    });

    test.each(["spl.abilities[].featureBlocksCount", "spl.abilities[].featureBlocksOffset"])(
        "%s carries editable: false",
        (key) => {
            expect(entries[key]).toMatchObject({ editable: false });
        },
    );
});
