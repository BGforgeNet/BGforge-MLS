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

describe("structureOp add", () => {
    it("adds a Global Variable and grows the collection by one", () => {
        const session = open();
        const before = globalVarCount(session);
        const result = structureOp(session, { op: "add", namePath: ["Global Variables"] });
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
