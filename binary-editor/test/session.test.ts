import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");
function bytes() {
    return new Uint8Array(fs.readFileSync(MAP_FIXTURE));
}

describe("openSession", () => {
    it("opens a map and returns a layout, format name, and a root window", () => {
        const result = openSession("file:///arcaves.map", bytes());
        expect(result.format).toBe("map");
        expect(result.formatName.length).toBeGreaterThan(0);
        expect(result.layout.layout?.variantId).toBe("map");
        expect(Object.keys(result.layout.layout?.sections ?? {}).length).toBeGreaterThan(0);
        expect(result.rootWindow.length).toBeGreaterThan(0);
        expect(sessionStore.get(result.sessionId)).toBeDefined();
    });

    it("rejects an unknown extension with an error result", () => {
        const result = openSession("file:///x.unknown", new Uint8Array([1, 2, 3]));
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.rootWindow.length).toBe(0);
    });

    it("derives the extension from the path, ignoring a query (game-resource URIs carry ?g=<dir>)", () => {
        // The IE resource viewer addresses records as bgforge-ie-resource:/<resref>.<ext>?g=<gameDir>; a naive
        // last-"." split would read the extension as "map?g=..." and find no parser. The dir has a "." too.
        const result = openSession("bgforge-ie-resource:/arcaves.map?g=/home/user/games/bg2.ee/tob", bytes());
        expect(result.format).toBe("map");
        expect(result.errors.length).toBe(0);
        expect(result.rootWindow.length).toBeGreaterThan(0);
    });
});
