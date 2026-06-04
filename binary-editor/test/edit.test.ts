import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { buildModel, setExpanded } from "../src/model";
import { editField } from "../src/edit";
import { undo } from "../src/structure-ops";
import type { ParsedField, ParseResult } from "@bgforge/binary";
import { ieEffectsModel } from "../src/relationship/ie-effects";

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

function effectSession(opcode: number): EditorSession {
    const result = {
        format: "eff",
        formatName: "EFF",
        root: {
            name: "EFF File",
            fields: [
                {
                    name: "Effect 1",
                    fields: [
                        {
                            name: "opcode",
                            value: opcode,
                            rawValue: opcode,
                            offset: 0,
                            size: 4,
                            type: "enum",
                            enumOptions: { [String(opcode)]: `op ${opcode}` },
                        },
                        { name: "parameter1", value: 5, offset: 8, size: 4, type: "uint32" },
                        { name: "parameter2", value: 2, offset: 12, size: 4, type: "uint32" },
                    ],
                },
            ],
        },
    } as unknown as ParseResult;
    return {
        id: "s1",
        uri: "file:///x.eff",
        parserId: "eff",
        parseOptions: {},
        model: buildModel(result),
        undo: [],
        redo: [],
        dirty: false,
        relationshipModel: ieEffectsModel,
    };
}

describe("reactive shaping", () => {
    it("re-shapes the parameter rows when the opcode changes", () => {
        const session = effectSession(0);
        const result = editField(session, "0/0", 1); // edit opcode -> 1
        const changed = result.changeSet.changed;
        // edited row + both dependent params
        expect(changed.some((r) => r.id === "0/1" && r.name === "Key Modifier")).toBe(true);
        expect(changed.some((r) => r.id === "0/2" && r.name === "Type")).toBe(true);
    });

    it("editing a non-discriminator field returns only that row", () => {
        const session = effectSession(1);
        const result = editField(session, "0/1", 9); // edit parameter1
        expect(result.changeSet.changed.map((r) => r.id)).toEqual(["0/1"]);
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
