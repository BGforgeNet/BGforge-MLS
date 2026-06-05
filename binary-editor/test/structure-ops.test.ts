import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { structureOp, undo, redo } from "../src/structure-ops";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function open(): EditorSession {
    const { sessionId } = openSession("file:///arcaves.map", new Uint8Array(fs.readFileSync(MAP_FIXTURE)));
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("no session");
    return session;
}
function globalVarCount(session: EditorSession): number {
    const gv = session.model.nodes.find((n) => n.name === "Global Variables");
    if (!gv) throw new Error("no Global Variables group");
    return session.model.nodes.filter((n) => n.parentId === gv.id).length;
}
function firstGlobalVarName(session: EditorSession): string {
    const gv = session.model.nodes.find((n) => n.name === "Global Variables");
    if (!gv) throw new Error("no Global Variables group");
    const first = session.model.nodes.find((n) => n.parentId === gv.id);
    if (!first) throw new Error("no children under Global Variables");
    return first.name;
}

describe("structureOp add", () => {
    it("adds a Global Variable and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const result = structureOp(session, { op: "add", namePath: ["Global Variables"] });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("structureOp remove", () => {
    it("removes the targeted entry and shrinks the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "remove", entryPath: ["Global Variables", name] });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before - 1);
    });
});

describe("structureOp insert", () => {
    it("inserts after the targeted entry and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "insert", entryPath: ["Global Variables", name], position: "after" });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("structureOp reorder", () => {
    it("moving the first entry up is a boundary no-op (not dirty)", () => {
        const session = open();
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "reorder", entryPath: ["Global Variables", name], direction: "up" });
        expect(result.changeSet.dirty).toBe(false);
    });
});

describe("structureOp duplicate", () => {
    it("duplicates the targeted entry and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "duplicate", entryPath: ["Global Variables", name] });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("undo / redo", () => {
    it("undo restores the prior collection size; redo re-applies", () => {
        const session = open();
        const before = globalVarCount(session);
        structureOp(session, { op: "add", namePath: ["Global Variables"] });
        undo(session);
        expect(globalVarCount(session)).toBe(before);
        redo(session);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});
