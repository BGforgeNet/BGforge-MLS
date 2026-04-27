/**
 * Tree-state propagation of `editingLocked` from incomplete records to their fields.
 *
 * When the parser couldn't fully decode a record (e.g. a MAP Item or Scenery
 * object whose subtype payload is described by an unavailable `.pro` file),
 * the enclosing group carries `editingLocked: true`. The tree builder must
 * thread that flag down so every field summary inside the locked record
 * renders as non-editable in the webview.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "@bgforge/binary";
import { buildBinaryEditorTreeState } from "../src/editors/binaryEditor-tree";

function loadArcaves() {
    const data = new Uint8Array(fs.readFileSync(path.resolve("client/testFixture/maps/arcaves.map")));
    return mapParser.parse(data);
}

describe("tree state propagates editingLocked from incomplete records", () => {
    it("fields under an Object N.M (Scenery) group render as non-editable", () => {
        const tree = buildBinaryEditorTreeState(loadArcaves());

        // Walk the tree to find a Scenery object's children.
        const visitedFieldNames: string[] = [];
        let visitedSomeSceneryField = false;
        const walkChildren = (nodeId: string, sceneryAncestor: boolean) => {
            for (const child of tree.getChildren(nodeId)) {
                if (child.kind === "group") {
                    const isSceneryGroup = /^Object \d+\.\d+ \(Scenery\)$/.test(child.name);
                    walkChildren(child.id, sceneryAncestor || isSceneryGroup);
                } else if (sceneryAncestor) {
                    visitedSomeSceneryField = true;
                    visitedFieldNames.push(child.name);
                    expect(
                        child.editable,
                        `field "${child.name}" inside locked Scenery group should be non-editable`,
                    ).toBe(false);
                }
            }
        };
        for (const root of tree.getInitMessagePayload().rootChildren) {
            walkChildren(root.id, false);
        }
        expect(visitedSomeSceneryField, "expected to visit at least one field inside a Scenery group").toBe(true);
    });

    it("fields under fully-decoded Object N.M (Misc) groups remain editable per their schema rules", () => {
        const tree = buildBinaryEditorTreeState(loadArcaves());

        let sawEditableMiscField = false;
        const walkChildren = (nodeId: string, miscAncestor: boolean) => {
            for (const child of tree.getChildren(nodeId)) {
                if (child.kind === "group") {
                    const isMiscGroup = /^Object \d+\.\d+ \(Misc\)$/.test(child.name);
                    walkChildren(child.id, miscAncestor || isMiscGroup);
                } else if (miscAncestor && child.editable) {
                    sawEditableMiscField = true;
                }
            }
        };
        for (const root of tree.getInitMessagePayload().rootChildren) {
            walkChildren(root.id, false);
        }
        expect(sawEditableMiscField, "expected at least one editable field inside a Misc group").toBe(true);
    });
});
