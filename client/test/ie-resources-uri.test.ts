import { describe, it, expect, vi } from "vitest";

// uri.ts wraps vscode.Uri around the pure resref/ext/query encoding. Mock Uri minimally (store the parts
// verbatim) so the test exercises this module's own encode/decode round-trip, not vscode.Uri internals.
vi.mock("vscode", () => ({
    Uri: {
        from: (parts: { scheme: string; path: string; query: string }) => ({
            scheme: parts.scheme,
            path: parts.path,
            query: parts.query,
        }),
    },
}));

// Imported after vi.mock so the mocked vscode is in place.
import { resourceUri, parseResourceUri, GAME_RESOURCE_SCHEME } from "../src/ie-resources/uri";

describe("ie-resources resource URI", () => {
    it("round-trips gameDir (incl. spaces), resref, and ext", () => {
        const uri = resourceUri("/games/bg2 ee/data", "SW1H01", "ITM");
        expect(uri.scheme).toBe(GAME_RESOURCE_SCHEME);
        expect(uri.path).toBe("/sw1h01.itm"); // lowercased filename so the editor matches by extension
        expect(parseResourceUri(uri)).toEqual({
            gameDir: "/games/bg2 ee/data",
            resref: "sw1h01",
            ext: "itm",
        });
    });

    it("parses a filename with no extension", () => {
        const uri = resourceUri("/g", "noext", "");
        const parsed = parseResourceUri(uri);
        expect(parsed.resref).toBe("noext");
        expect(parsed.ext).toBe("");
        expect(parsed.gameDir).toBe("/g");
    });
});
