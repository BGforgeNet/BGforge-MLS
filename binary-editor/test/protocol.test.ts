import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dispatch } from "../src/protocol";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");
const bytes = () => new Uint8Array(fs.readFileSync(MAP_FIXTURE));

describe("dispatch", () => {
    it("opens, expands, windows, edits, and serializes through the protocol", () => {
        const opened = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: bytes() });
        if (opened.type !== "opened") throw new Error("expected opened");
        const sessionId = opened.result.sessionId;

        const gvSection = opened.result.layout.sections.find((s) => s.title === "Global Variables");
        expect(gvSection).toBeDefined();
        if (!gvSection) throw new Error("no Global Variables section");
        const exp = dispatch({ type: "expand", sessionId, nodeId: gvSection.nodeId, expanded: true });
        expect(exp.type).toBe("window");

        const win = dispatch({ type: "getWindow", sessionId, start: 0, end: 500 });
        if (win.type !== "window") throw new Error("expected window");
        const field = win.rows.find((r) => r.kind === "field");
        expect(field).toBeDefined();
        if (!field) throw new Error("no field row");

        const edit = dispatch({ type: "editField", sessionId, nodeId: field.id, value: 5 });
        if (edit.type !== "edited") throw new Error("expected edited");
        expect(edit.result.changeSet.dirty).toBe(true);

        const ser = dispatch({ type: "serialize", sessionId });
        if (ser.type !== "serialized") throw new Error("expected serialized");
        expect(ser.bytes.length).toBeGreaterThan(0);
    });

    it("returns an error response for an unknown session", () => {
        const res = dispatch({ type: "getWindow", sessionId: "nope", start: 0, end: 1 });
        expect(res.type).toBe("error");
    });
});
