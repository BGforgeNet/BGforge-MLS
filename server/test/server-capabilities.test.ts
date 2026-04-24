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
});
