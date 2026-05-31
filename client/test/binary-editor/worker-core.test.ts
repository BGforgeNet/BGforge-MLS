import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkerHandler, deriveParseOptions } from "../../src/binary-editor/worker-core";

const MAP_FIXTURE = path.resolve(__dirname, "../../testFixture/maps/arcaves.map");
const bytes = () => new Uint8Array(fs.readFileSync(MAP_FIXTURE));

describe("deriveParseOptions", () => {
    it("sets skipMapTiles for a .map path", () => {
        expect(deriveParseOptions("/x/foo.map")?.skipMapTiles).toBe(true);
    });
    it("returns undefined for a non-map path", () => {
        expect(deriveParseOptions("/x/foo.pro")).toBeUndefined();
    });
});

describe("worker handler", () => {
    it("opens a map and returns a layout + root window", () => {
        const handle = createWorkerHandler();
        const res = handle({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
        expect(res.type).toBe("opened");
        if (res.type !== "opened") return;
        expect(res.result.format).toBe("map");
        expect(res.result.rootWindow.length).toBeGreaterThan(0);
    });

    it("derives parse options from the uri without a caller-supplied function", () => {
        const handle = createWorkerHandler();
        const res = handle({ type: "open", uri: `file://${MAP_FIXTURE}`, bytes: bytes() });
        expect(res.type).toBe("opened");
    });

    it("passes non-open requests straight through to dispatch", () => {
        const handle = createWorkerHandler();
        const err = handle({ type: "getWindow", sessionId: "nope", start: 0, end: 1 });
        expect(err.type).toBe("error");
    });
});
