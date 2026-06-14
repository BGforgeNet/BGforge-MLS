/**
 * MAP cross-record jump links: a script's Owner ID resolves to its owning object, and an object's SID resolves
 * to the script it runs. The link rides on the Row (via the relationship overlay) so the view can navigate.
 *
 * Parsed WITH the PRO resolver (buildFileDerivedParseOptions) so objects decode - the links only resolve when
 * both the objects and scripts are present.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, buildFileDerivedParseOptions } from "@bgforge/binary";
import { buildModel, type Model } from "../src/model";
import { projectRow } from "../src/window";
import { getRelationshipModel } from "../src/relationship/registry";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/denbus1.map");
const rel = getRelationshipModel("map")!;

function mapModel(): Model {
    const opts = { ...buildFileDerivedParseOptions(FIXTURE), skipMapTiles: true };
    return buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE)), opts));
}

function childRawValue(m: Model, entryId: string, name: string): number | string | undefined {
    for (const i of m.childrenByParent.get(entryId) ?? []) {
        const c = m.nodes[i]!;
        if (c.kind === "field" && c.name === name) return projectRow(m, c).rawValue;
    }
    return undefined;
}

/** Section (depth-0) name of a FIELD node: field -> entry -> section. */
function sectionNameOf(m: Model, fieldNode: { parentId?: string }): string | undefined {
    const entry = fieldNode.parentId !== undefined ? m.nodes[m.byId.get(fieldNode.parentId)!] : undefined;
    const section = entry?.parentId !== undefined ? m.nodes[m.byId.get(entry.parentId)!] : undefined;
    return section?.name;
}

/** Section name of an ENTRY node: entry -> section. */
function entrySectionName(m: Model, entry: { parentId?: string }): string | undefined {
    return entry.parentId !== undefined ? m.nodes[m.byId.get(entry.parentId)!]?.name : undefined;
}

describe("MAP cross-record jump links", () => {
    it("registers a relationship model for map", () => {
        expect(rel).toBeDefined();
    });

    it("links a script Owner ID to the object whose ID matches", () => {
        const m = mapModel();
        const node = m.nodes.find((n) => n.name === "Owner ID" && projectRow(m, n, rel).link !== undefined);
        expect(node, "a script with a resolvable Owner ID exists in denbus1").toBeDefined();
        const row = projectRow(m, node!, rel);
        const target = m.nodes[m.byId.get(row.link!.targetNodeId)!]!;
        // The jump target is the object entry whose ID equals the owner id, labelled by the entry name.
        expect(childRawValue(m, target.id, "ID")).toBe(row.rawValue);
        expect(row.link!.label).toBe(target.name);
        expect(entrySectionName(m, target)?.endsWith("Objects")).toBe(true);
    });

    it("links an object SID to the script whose SID matches", () => {
        const m = mapModel();
        const node = m.nodes.find((n) => n.name === "SID" && projectRow(m, n, rel).link !== undefined);
        expect(node, "an object with a resolvable SID exists in denbus1").toBeDefined();
        const row = projectRow(m, node!, rel);
        const target = m.nodes[m.byId.get(row.link!.targetNodeId)!]!;
        expect(childRawValue(m, target.id, "SID")).toBe(row.rawValue);
        expect(entrySectionName(m, target)?.endsWith("Scripts")).toBe(true);
    });

    it("does not link a script's own SID (identity, not a reference)", () => {
        const m = mapModel();
        const scriptSid = m.nodes.find((n) => n.name === "SID" && sectionNameOf(m, n)?.endsWith("Scripts") === true);
        expect(scriptSid, "a script entry SID exists").toBeDefined();
        expect(projectRow(m, scriptSid!, rel).link).toBeUndefined();
    });
});
