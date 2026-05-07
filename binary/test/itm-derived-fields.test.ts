import { describe, expect, test } from "vitest";
import { itmPresentationSchema } from "../src/itm/presentation-schema";

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
