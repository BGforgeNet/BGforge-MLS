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
});
