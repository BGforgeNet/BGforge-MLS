/**
 * Engine-internal MAP fields are hidden from the detail via the field's own `hidden` flag (spec `hidden: true`,
 * or set at construction), so a display relabel can never silently un-hide them. The field stays in the model
 * for byte round-trip; the renderer (FormSection) skips rows where `hidden === true`.
 *
 * fallout2-ce confirms the script-slot fields carry no authored meaning: field_4 (scr_next) and field_48 are
 * read/written but referenced nowhere; field_50 is runtime string-lookup scratch.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/newr2.map");

function nonEmptyScriptSection(m: ReturnType<typeof buildModel>) {
    return m.nodes.find((n) => (n.name ?? "").endsWith("Scripts") && m.nodes.some((c) => c.parentId === n.id));
}

describe("MAP hidden engine-internal script fields", () => {
    it("flags Next Script Link / Unknown Field 0x48 / Legacy Field 0x50 hidden (kept in the model)", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE))));
        const section = nonEmptyScriptSection(m)!;
        const firstScript = m.nodes.find((n) => n.parentId === section.id)!;
        for (const name of ["Next Script Link (legacy)", "Unknown Field 0x48", "Legacy Field 0x50"]) {
            const node = m.nodes.find((n) => n.parentId === firstScript.id && n.name === name);
            expect(node, `${name} stays in the model for round-trip`).toBeDefined();
            expect(projectRow(m, node!).hidden, `${name} is flagged hidden`).toBe(true);
        }
    });
});
