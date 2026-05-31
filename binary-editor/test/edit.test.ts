import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { setExpanded } from "../src/model";
import { editField } from "../src/edit";
import { undo } from "../src/structure-ops";
import type { ParsedField } from "@bgforge/binary";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

function openAndExpandGlobals() {
    const { sessionId } = openSession("file:///arcaves.map", new Uint8Array(fs.readFileSync(MAP_FIXTURE)));
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("no session");
    const gv = session.model.nodes.find((n) => n.name === "Global Variables");
    if (!gv) throw new Error("no Global Variables group");
    setExpanded(session.model, gv.id, true);
    return { session, gv };
}

describe("editField", () => {
    it("updates a global var value and returns the changed row + dirty", () => {
        const { session, gv } = openAndExpandGlobals();
        const child = session.model.nodes.find((n) => n.parentId === gv.id && n.kind === "field");
        expect(child).toBeDefined();
        if (!child) return;
        const result = editField(session, child.id, 42);
        expect(result.changeSet.dirty).toBe(true);
        expect(result.changeSet.formatValid).toBe(true);
        const changed = result.changeSet.changed.find((r) => r.id === child.id);
        expect(changed).toBeDefined();
        expect(changed?.displayValue).toBe("42");
    });

    it("pushes an undo entry", () => {
        const { session, gv } = openAndExpandGlobals();
        const child = session.model.nodes.find((n) => n.parentId === gv.id && n.kind === "field");
        expect(child).toBeDefined();
        if (!child) return;
        editField(session, child.id, 7);
        expect(session.undo.length).toBe(1);
    });
});

it("undo after a field edit restores the prior value", () => {
    const { session, gv } = openAndExpandGlobals();
    const child = session.model.nodes.find((n) => n.parentId === gv.id && n.kind === "field");
    expect(child).toBeDefined();
    if (!child) return;
    const original = (child.source as ParsedField).value;
    editField(session, child.id, 999);
    undo(session);
    const after = session.model.nodes.find((n) => n.id === child.id);
    expect(after).toBeDefined();
    if (!after) return;
    expect((after.source as ParsedField).value).toBe(original);
});
