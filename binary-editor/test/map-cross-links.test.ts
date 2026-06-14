/**
 * MAP cross-record jump links, both driven by the authoritative object<->script `sid` binding: an object's SID
 * names the script it runs; that same value is the script's own SID. So an object's SID links to its script,
 * and a script's SID links to the object that runs it (whose SID equals this script's sid).
 *
 * The script's Owner ID (scr_oid) is NOT linked: fallout2-ce sets it from the object at runtime bind time
 * (scripts.cc: `script->ownerId = object->id` after `scriptGetScript(object->sid, ...)`), so on disk it is
 * stale/wrong - Broken Hills' map has Owner IDs pointing at unrelated objects of the wrong type.
 *
 * Parsed WITH the PRO resolver so objects decode (links only resolve when both records are present).
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

const sidNodeIn = (m: Model, suffix: string) =>
    m.nodes.find(
        (n) =>
            n.name === "SID" &&
            sectionNameOf(m, n)?.endsWith(suffix) === true &&
            projectRow(m, n, rel).link !== undefined,
    );

describe("MAP cross-record jump links", () => {
    it("registers a relationship model for map", () => {
        expect(rel).toBeDefined();
    });

    it("links an object's SID to the script it runs (same sid)", () => {
        const m = mapModel();
        const node = sidNodeIn(m, "Objects");
        expect(node, "an object with a resolvable SID exists in denbus1").toBeDefined();
        const row = projectRow(m, node!, rel);
        const target = m.nodes[m.byId.get(row.link!.targetNodeId)!]!;
        expect(entrySectionName(m, target)?.endsWith("Scripts")).toBe(true);
        // The linked script's own SID equals the object's SID value (the shared binding key).
        expect(childRawValue(m, target.id, "SID")).toBe(row.rawValue);
        expect(row.link!.label).toBe(target.name);
    });

    it("links a script's SID to the object that runs it (object SID equals this script's sid)", () => {
        const m = mapModel();
        const node = sidNodeIn(m, "Scripts");
        expect(node, "a script referenced by an object exists in denbus1").toBeDefined();
        const row = projectRow(m, node!, rel);
        const target = m.nodes[m.byId.get(row.link!.targetNodeId)!]!;
        expect(entrySectionName(m, target)?.endsWith("Objects")).toBe(true);
        // The owning object's SID equals this script's sid.
        expect(childRawValue(m, target.id, "SID")).toBe(row.rawValue);
    });

    it("does not link a script's Owner ID (engine runtime state, not the authored binding)", () => {
        const m = mapModel();
        const owner = m.nodes.find((n) => n.name === "Owner ID");
        expect(owner, "a script Owner ID field exists").toBeDefined();
        expect(projectRow(m, owner!, rel).link).toBeUndefined();
    });
});
