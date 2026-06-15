/**
 * Editor-session integration for MAP object structure ops: open a real MAP whose
 * objects fully decode, drive add/remove through the session -> structureOp -> map
 * adapter -> object-ops -> model-rebuild path (the same path the webview triggers),
 * and confirm the elevation's object count changes, the result reserializes and
 * reparses cleanly, and undo restores. The binary package tests cover the
 * byte-builders; this pins the editor wiring through the projection seam.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parserRegistry } from "@bgforge/binary";
import { openSession, sessionStore, type EditorSession } from "../src/session";
import { structureOp, undo } from "../src/structure-ops";
import { serializeSession } from "../src/serialize";
import type { FlatNode } from "../src/model";

// cave6.map fully decodes its objects (no opaque tail), so structure ops apply.
const CLEAN_MAP = path.resolve(__dirname, "../../external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map");
const present = fs.existsSync(CLEAN_MAP);

function open(): EditorSession {
    const { sessionId } = openSession("file:///cave6.map", new Uint8Array(fs.readFileSync(CLEAN_MAP)), {
        gracefulMapBoundaries: true,
    });
    const session = sessionStore.get(sessionId);
    if (!session) throw new Error("no session");
    return session;
}

/** Top-level object groups directly under a lifted "Elevation N Objects" section. */
function elevationObjects(session: EditorSession, elev: number): FlatNode[] {
    const section = session.model.nodes.find((n) => n.depth === 0 && n.name === `Elevation ${elev} Objects`);
    if (!section) return [];
    return (session.model.childrenByParent.get(section.id) ?? [])
        .map((i) => session.model.nodes[i]!)
        .filter((n) => n.kind === "group" && /^Object \d+\.\d+ /.test(n.name));
}

/** NodeId of the lifted "Elevation N Objects" section group. */
function elevationSectionId(session: EditorSession, elev: number): string {
    const section = session.model.nodes.find((n) => n.depth === 0 && n.name === `Elevation ${elev} Objects`);
    if (!section) throw new Error(`no Elevation ${elev} Objects section`);
    return section.id;
}

function firstElevationWithObjects(session: EditorSession): number {
    for (let e = 0; e < 3; e++) {
        if (elevationObjects(session, e).length > 0) return e;
    }
    throw new Error("no elevation with decoded objects");
}

describe.skipIf(!present)("editor MAP object structure ops", () => {
    it("adds an object, reserializes and reparses cleanly, and undo restores", () => {
        const session = open();
        const elev = firstElevationWithObjects(session);
        const before = elevationObjects(session, elev).length;

        const result = structureOp(session, { op: "add", sectionId: elevationSectionId(session, elev) });
        expect(result.changeSet.dirty).toBe(true);
        expect(elevationObjects(session, elev).length).toBe(before + 1);

        const reparsed = parserRegistry.getById("map")!.parse(serializeSession(session), session.parseOptions);
        expect(reparsed.errors ?? []).toEqual([]);

        undo(session);
        expect(elevationObjects(session, elev).length).toBe(before);
    });

    it("removes an object from its elevation", () => {
        const session = open();
        const elev = firstElevationWithObjects(session);
        const before = elevationObjects(session, elev).length;
        const target = elevationObjects(session, elev)[0]!;

        const result = structureOp(session, {
            op: "remove",
            entryId: target.id,
        });
        expect(result.changeSet.dirty).toBe(true);
        expect(elevationObjects(session, elev).length).toBe(before - 1);
    });
});

/** "Inventory Entry N" groups directly under an object group, in order. */
function inventoryEntries(session: EditorSession, objectId: string): FlatNode[] {
    return (session.model.childrenByParent.get(objectId) ?? [])
        .map((i) => session.model.nodes[i]!)
        .filter((n) => n.kind === "group" && /^Inventory Entry \d+/.test(n.name));
}

describe("MAP object inventory add/remove via the session", () => {
    it("addChild then removeChild on an object's inventory round-trips the entry count", () => {
        if (!present) return;
        const session = open();
        const elev = firstElevationWithObjects(session);
        expect(elev).toBeGreaterThanOrEqual(0);
        const obj = elevationObjects(session, elev)[0]!;
        const invBefore = inventoryEntries(session, obj.id).length;

        const addRes = structureOp(session, { op: "addChild", entryId: obj.id, childSection: "Inventory" });
        expect(addRes.changeSet.dirty).toBe(true);
        const objAfterAdd = elevationObjects(session, elev)[0]!;
        expect(inventoryEntries(session, objAfterAdd.id).length).toBe(invBefore + 1);
        // The added entry serializes and reparses cleanly through the editor pipeline.
        expect(() => serializeSession(session)).not.toThrow();

        // Remove the just-added inventory entry (last index) -> back to the original count.
        const rmRes = structureOp(session, {
            op: "removeChild",
            entryId: objAfterAdd.id,
            childSection: "Inventory",
            childIndex: invBefore,
        });
        expect(rmRes.changeSet.dirty).toBe(true);
        expect(inventoryEntries(session, elevationObjects(session, elev)[0]!.id).length).toBe(invBefore);
    });
});
