import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openSession, sessionStore } from "../src/session";
import { setExpanded } from "../src/model";
import { editField, invalidateCachedDocument } from "../src/edit";
import { undo } from "../src/structure-ops";
import { formatAdapterRegistry, type ParseResult, type ParsedField } from "@bgforge/binary";
import { openItmSession, firstEffectFields, itmFixturePresent } from "./ie-fixture";

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

describe("reactive shaping (real ITM display tree)", () => {
    it("re-shapes the parameter rows when the opcode changes", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const p1Id = f.get("parameter1")!.id;
        const p2Id = f.get("parameter2")!.id;
        const result = editField(session, f.get("opcode")!.id, 1); // opcode -> 1
        const changed = result.changeSet.changed;
        // edited row + both dependent params, re-projected through the overlay
        expect(changed.some((r) => r.id === p1Id && r.name === "Key Modifier")).toBe(true);
        expect(changed.some((r) => r.id === p2Id && r.name === "Type")).toBe(true);
    });

    it("editing a non-discriminator field returns only that row", () => {
        if (!itmFixturePresent()) return;
        const session = openItmSession();
        const f = firstEffectFields(session.model);
        const p1Id = f.get("parameter1")!.id;
        const result = editField(session, p1Id, 9);
        expect(result.changeSet.changed.map((r) => r.id)).toEqual([p1Id]);
    });
});

// Finding #6a: cache invalidation is driven by the adapter's explicit `documentCacheStrategy`, not by
// reflecting on the shape of the `document` property. A new format that forgets to declare the strategy
// fails to compile (it is required); these pin the dispatch behaviour at runtime.
describe("invalidateCachedDocument (per-adapter cache strategy)", () => {
    // invalidateCachedDocument only reads `format` and writes `document`; the document's contents are
    // irrelevant to the dispatch, so a single opaque placeholder is cast in at this test boundary and
    // checked by reference identity / undefined-ness rather than by shape.
    const sentinelDoc = {} as ParseResult["document"];
    function fakeResult(format: string): ParseResult {
        return {
            format,
            formatName: format,
            root: { name: "root", fields: [], expanded: true },
            document: sentinelDoc,
        };
    }

    it("every built-in format declares a documentCacheStrategy", () => {
        for (const id of ["pro", "map", "itm", "spl", "eff", "cre"]) {
            const strategy = formatAdapterRegistry.get(id)?.documentCacheStrategy;
            expect(strategy === "clear" || strategy === "none").toBe(true);
        }
    });

    it("clears the cached document for a 'clear' format", () => {
        const pr = fakeResult("pro");
        invalidateCachedDocument(pr);
        expect(pr.document).toBeUndefined();
    });

    it("leaves the cached document untouched for an unregistered format (no strategy)", () => {
        const pr = fakeResult("not-a-real-format");
        invalidateCachedDocument(pr);
        expect(pr.document).toBe(sentinelDoc);
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
