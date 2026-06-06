import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { summaryComposerFor } from "../src/summary";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/artemple.map");

describe("map object summary", () => {
    it("summarizes a lifted object entry by its PID", () => {
        const data = new Uint8Array(fs.readFileSync(MAP_FIXTURE));
        const model = buildModel(mapParser.parse(data, { gracefulMapBoundaries: true }));
        // A top-level object node lives under a lifted "Elevation N Objects" section.
        const obj = model.nodes.find(
            (n) => /^Object \d+\.\d+ /.test(n.name) && /^Elevation \d+ Objects$/.test(n.namePath[0] ?? ""),
        );
        expect(obj).toBeDefined();

        const compose = summaryComposerFor("map");
        expect(compose).toBeDefined();
        const summary = compose!(obj!, model, undefined);
        // The object's PID field is present, so the summary resolves to its displayValue.
        expect(typeof summary).toBe("string");
        expect((summary ?? "").length).toBeGreaterThan(0);
    });
});
