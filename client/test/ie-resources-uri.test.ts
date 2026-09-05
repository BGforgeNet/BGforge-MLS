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
import {
    animationSetUri,
    parseAnimationSetUri,
    resourceUri,
    parseResourceUri,
    GAME_RESOURCE_SCHEME,
} from "../src/ie-resources/uri";

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

describe("ie-resources animation set URI", () => {
    it("round-trips the game directory and the animation id", () => {
        const uri = animationSetUri("/games/bg2 ee/data", 0x6004);

        expect(uri.scheme).toBe(GAME_RESOURCE_SCHEME);
        expect(parseAnimationSetUri(uri)).toEqual({ gameDir: "/games/bg2 ee/data", id: 0x6004 });
    });

    /** Four hex digits is how an install names the animation's own declaration, so the address reads like one. */
    it("names the set by its id in hex", () => {
        expect(animationSetUri("/g", 0x6004).path).toBe("/6004.animset");
        expect(animationSetUri("/g", 0x2).path).toBe("/0002.animset");
    });

    /**
     * The decode IS the predicate, so nothing has to derive "is this a set" a second way. A single-resource
     * URI must come back undefined rather than as some set: they share a scheme, and every consumer that
     * branches between them reads this one answer.
     */
    it("refuses a single-resource URI", () => {
        expect(parseAnimationSetUri(resourceUri("/g", "SW1H01", "ITM"))).toBeUndefined();
    });

    it("refuses a set-shaped path whose id is not hex", () => {
        const notHex = { ...animationSetUri("/g", 0x6004), path: "/zzzz.animset" };

        expect(parseAnimationSetUri(notHex)).toBeUndefined();
    });

    /** `parseInt` reads a prefix, so an unanchored check would open set 6 for an address naming "6zz". */
    it("refuses an id with a trailing non-hex character rather than reading its prefix", () => {
        const trailing = { ...animationSetUri("/g", 0x6004), path: "/6zz.animset" };

        expect(parseAnimationSetUri(trailing)).toBeUndefined();
    });
});
