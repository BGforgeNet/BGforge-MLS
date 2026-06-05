import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { structureOp, undo, redo } from "../src/structure-ops";
import type { FlatNode } from "../src/model";

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
/** Returns the NodeIds of all direct children of `parentId` in their stored order. */
function varChildren(session: EditorSession, parentId: string): FlatNode[] {
    const indices = session.model.childrenByParent.get(parentId) ?? [];
    return indices.map((i) => session.model.nodes[i]!);
}
/** Opens a fresh session and returns it along with the Global Variables group node. */
function openMapWithGlobals(): { session: EditorSession; gv: FlatNode } {
    const session = open();
    const gv = session.model.nodes.find((n) => n.name === "Global Variables");
    if (!gv) throw new Error("no Global Variables group");
    return { session, gv };
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

function globalValues(session: EditorSession): number[] {
    const gv = session.model.nodes.find((n) => n.name === "Global Variables")!;
    return varChildren(session, gv.id).map((n) => (n.source as { value: number }).value);
}

describe("structureOp insert", () => {
    it("inserts after the targeted entry and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "insert", entryPath: ["Global Variables", name], position: "after" });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });

    it("inserts before the targeted entry and selects the inserted position", () => {
        const { session, gv } = openMapWithGlobals();
        const before = globalVarCount(session);
        const targetName = varChildren(session, gv.id)[1]!.name; // second entry
        const result = structureOp(session, {
            op: "insert",
            entryPath: ["Global Variables", targetName],
            position: "before",
        });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
        // inserted before index 1 -> the new entry occupies index 1, and selection points at it
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect(result.selection).toBe(varChildren(session, gv2.id)[1]!.id);
    });
});

describe("structureOp reorder", () => {
    it("moving the first entry up is a boundary no-op (not dirty)", () => {
        const session = open();
        const name = firstGlobalVarName(session);
        const result = structureOp(session, { op: "reorder", entryPath: ["Global Variables", name], direction: "up" });
        expect(result.changeSet.dirty).toBe(false);
    });

    it("moving an entry down swaps it with its successor and selects the new position", () => {
        const { session, gv } = openMapWithGlobals();
        const [v0, v1] = globalValues(session).slice(0, 2);
        const firstName = varChildren(session, gv.id)[0]!.name;
        const result = structureOp(session, {
            op: "reorder",
            entryPath: ["Global Variables", firstName],
            direction: "down",
        });
        expect(result.changeSet.dirty).toBe(true);
        const [a0, a1] = globalValues(session).slice(0, 2);
        expect(a0).toBe(v1);
        expect(a1).toBe(v0);
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect(result.selection).toBe(varChildren(session, gv2.id)[1]!.id);
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

describe("structureOp selection", () => {
    it("selects the new entry after add (last child)", () => {
        const { session } = openMapWithGlobals();
        const res = structureOp(session, { op: "add", namePath: ["Global Variables"] });
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        const kids = varChildren(session, gv2.id);
        expect(res.selection).toBe(kids[kids.length - 1]!.id);
    });

    it("selects the copy after duplicate (index+1)", () => {
        const { session, gv } = openMapWithGlobals();
        const kids = varChildren(session, gv.id);
        const res = structureOp(session, { op: "duplicate", entryPath: ["Global Variables", kids[0]!.name] });
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect(res.selection).toBe(varChildren(session, gv2.id)[1]!.id);
    });
});
