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

    it("returns a json snapshot for an open session", () => {
        const opened = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: bytes() });
        if (opened.type !== "opened") throw new Error("expected opened");
        const snap = dispatch({ type: "snapshot", sessionId: opened.result.sessionId });
        expect(snap.type).toBe("snapshot");
        if (snap.type !== "snapshot") return;
        expect(snap.json.length).toBeGreaterThan(0);
        expect(() => JSON.parse(snap.json)).not.toThrow();
    });

    it("getChildren returns roots for null nodeId and a node's children otherwise", () => {
        const opened = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: bytes() });
        if (opened.type !== "opened") throw new Error("open failed");
        const sid = opened.result.sessionId;

        const roots = dispatch({ type: "getChildren", sessionId: sid, nodeId: null, start: 0, end: 1000 });
        expect(roots.type).toBe("children");
        if (roots.type !== "children") throw new Error("expected children");
        expect(roots.parentId).toBeNull();
        expect(roots.total).toBeGreaterThan(0);
        expect(roots.rows.every((r) => r.depth === 0)).toBe(true);

        const firstGroup = roots.rows.find((r) => r.kind === "group")!;
        const kids = dispatch({ type: "getChildren", sessionId: sid, nodeId: firstGroup.id, start: 0, end: 1000 });
        expect(kids.type).toBe("children");
        if (kids.type !== "children") throw new Error("expected children");
        expect(kids.parentId).toBe(firstGroup.id);
    });

    it("loadJson rebuilds the model from a snapshot round-trip and is undoable", () => {
        const opened = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: bytes() });
        if (opened.type !== "opened") throw new Error("open failed");
        const sid = opened.result.sessionId;

        const snap = dispatch({ type: "snapshot", sessionId: sid });
        if (snap.type !== "snapshot") throw new Error("snapshot failed");

        const loaded = dispatch({ type: "loadJson", sessionId: sid, json: snap.json });
        expect(loaded.type).toBe("opened");
        if (loaded.type !== "opened") throw new Error("expected opened");
        expect(loaded.result.sessionId).toBe(sid);
        expect(loaded.result.format).toBe(opened.result.format);

        const undone = dispatch({ type: "undo", sessionId: sid });
        expect(undone.type).toBe("window");
    });

    it("loadJson rejects malformed JSON without changing the session", () => {
        const opened = dispatch({ type: "open", uri: "file:///arcaves.map", bytes: bytes() });
        if (opened.type !== "opened") throw new Error("open failed");
        const before = dispatch({
            type: "getChildren",
            sessionId: opened.result.sessionId,
            nodeId: null,
            start: 0,
            end: 1,
        });
        const bad = dispatch({ type: "loadJson", sessionId: opened.result.sessionId, json: "{not json" });
        expect(bad.type).toBe("error");
        const after = dispatch({
            type: "getChildren",
            sessionId: opened.result.sessionId,
            nodeId: null,
            start: 0,
            end: 1,
        });
        expect(after).toEqual(before);
    });
});
