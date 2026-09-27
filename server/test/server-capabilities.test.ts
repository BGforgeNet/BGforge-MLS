import { describe, expect, it } from "vitest";

import { getServerCapabilities } from "../src/server-capabilities";

describe("server-capabilities", () => {
    it("advertises full semantic tokens with the shared legend", () => {
        const capabilities = getServerCapabilities();

        expect(capabilities.semanticTokensProvider).toEqual({
            legend: {
                tokenTypes: [
                    "parameter",
                    "variable",
                    "resref",
                    "byte",
                    "char",
                    "dword",
                    "int",
                    "2da-c0",
                    "2da-c1",
                    "2da-c2",
                    "2da-c3",
                    "2da-c4",
                    "2da-c5",
                ],
                tokenModifiers: [],
            },
            full: true,
        });
    });

    it("does not advertise completion resolve, since every item is complete when first returned", () => {
        // A resolve provider makes the client send completionItem/resolve for each item it shows; with
        // nothing to add, that is a round trip per item for no change.
        expect(getServerCapabilities().completionProvider).toStrictEqual({
            completionItem: { labelDetailsSupport: true },
            triggerCharacters: ["@"],
        });
    });
});
