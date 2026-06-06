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
function globalVarsNode(session: EditorSession): FlatNode {
    const gv = session.model.nodes.find((n) => n.name === "Global Variables");
    if (!gv) throw new Error("no Global Variables group");
    return gv;
}
function globalVarCount(session: EditorSession): number {
    return (session.model.childrenByParent.get(globalVarsNode(session).id) ?? []).length;
}
/** Returns all direct children of `parentId` in their stored order. */
function varChildren(session: EditorSession, parentId: string): FlatNode[] {
    const indices = session.model.childrenByParent.get(parentId) ?? [];
    return indices.map((i) => session.model.nodes[i]!);
}
/** NodeId of the entry at `index` under Global Variables. */
function globalVarId(session: EditorSession, index: number): string {
    const gv = globalVarsNode(session);
    const child = varChildren(session, gv.id)[index];
    if (!child) throw new Error(`no Global Variable at index ${index}`);
    return child.id;
}
/** Opens a fresh session and returns it along with the Global Variables group node. */
function openMapWithGlobals(): { session: EditorSession; gv: FlatNode } {
    const session = open();
    return { session, gv: globalVarsNode(session) };
}
function globalValues(session: EditorSession): number[] {
    const gv = globalVarsNode(session);
    return varChildren(session, gv.id).map((n) => (n.source as { value: number }).value);
}

describe("structureOp add", () => {
    it("adds a Global Variable and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const result = structureOp(session, { op: "add", sectionId: globalVarsNode(session).id });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("structureOp remove", () => {
    it("removes the targeted entry and shrinks the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const result = structureOp(session, { op: "remove", entryId: globalVarId(session, 0) });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before - 1);
    });
});

describe("structureOp insert", () => {
    it("inserts after the targeted entry and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const result = structureOp(session, { op: "insert", entryId: globalVarId(session, 0), position: "after" });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });

    it("inserts before the targeted entry and selects the inserted position", () => {
        const { session, gv } = openMapWithGlobals();
        const before = globalVarCount(session);
        const result = structureOp(session, {
            op: "insert",
            entryId: globalVarId(session, 1), // second entry
            position: "before",
        });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
        // inserted before index 1 -> the new entry occupies index 1, and selection points at it
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect(result.selection).toBe(varChildren(session, gv2.id)[1]!.id);
        void gv;
    });
});

describe("structureOp reorder", () => {
    it("moving the first entry up is a boundary no-op (not dirty)", () => {
        const session = open();
        const result = structureOp(session, { op: "reorder", entryId: globalVarId(session, 0), direction: "up" });
        expect(result.changeSet.dirty).toBe(false);
    });

    it("moving an entry down swaps it with its successor and selects the new position", () => {
        const { session } = openMapWithGlobals();
        const [v0, v1] = globalValues(session).slice(0, 2);
        const result = structureOp(session, {
            op: "reorder",
            entryId: globalVarId(session, 0),
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
        const result = structureOp(session, { op: "duplicate", entryId: globalVarId(session, 0) });
        expect(result.changeSet.dirty).toBe(true);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("undo / redo", () => {
    it("undo restores the prior collection size; redo re-applies", () => {
        const session = open();
        const before = globalVarCount(session);
        structureOp(session, { op: "add", sectionId: globalVarsNode(session).id });
        undo(session);
        expect(globalVarCount(session)).toBe(before);
        redo(session);
        expect(globalVarCount(session)).toBe(before + 1);
    });
});

describe("structureOp selection", () => {
    it("selects the new entry after add (last child)", () => {
        const { session } = openMapWithGlobals();
        const res = structureOp(session, { op: "add", sectionId: globalVarsNode(session).id });
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        const kids = varChildren(session, gv2.id);
        expect(res.selection).toBe(kids[kids.length - 1]!.id);
    });

    it("selects the copy after duplicate (index+1)", () => {
        const { session } = openMapWithGlobals();
        const res = structureOp(session, { op: "duplicate", entryId: globalVarId(session, 0) });
        const gv2 = session.model.nodes.find((n) => n.name === "Global Variables")!;
        expect(res.selection).toBe(varChildren(session, gv2.id)[1]!.id);
    });
});

// Finding #1 regression: structure ops are addressed by stable NodeId, and the editor resolves the
// target's byte index from its structural position - never by parsing the display label. So an entry
// whose label has been changed (presentation override / i18n / a relabel) must still target the exact
// byte slot at its structural ordinal. Before the fix, the byte-builders parsed the index out of the
// label string, so a renamed entry produced no parseable index and the op silently no-op'd (or, worse,
// hit the wrong slot). These tests would fail against that label-parsing path.
describe("structureOp addresses by structural identity, not display label (finding #1)", () => {
    it("removes the entry at the relabeled node's structural position", () => {
        const session = open();
        const before = globalValues(session);
        expect(before.length).toBeGreaterThanOrEqual(3);

        // Relabel the entry at index 1 so its display name no longer encodes its ordinal.
        const target = varChildren(session, globalVarsNode(session).id)[1]!;
        target.name = "Renamed Variable (no ordinal)";

        const result = structureOp(session, { op: "remove", entryId: target.id });
        expect(result.changeSet.dirty).toBe(true);

        // Exactly the value that was at index 1 is gone; the rest keep their order.
        const after = globalValues(session);
        expect(after).toEqual([before[0], ...before.slice(2)]);
    });

    it("reorders a relabeled entry by its structural position", () => {
        const session = open();
        const before = globalValues(session);
        expect(before.length).toBeGreaterThanOrEqual(2);

        const target = varChildren(session, globalVarsNode(session).id)[0]!;
        target.name = "Renamed";

        const result = structureOp(session, { op: "reorder", entryId: target.id, direction: "down" });
        expect(result.changeSet.dirty).toBe(true);
        const after = globalValues(session);
        expect(after[0]).toBe(before[1]);
        expect(after[1]).toBe(before[0]);
    });
});
