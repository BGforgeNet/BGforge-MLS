/**
 * MAP scripts render as a flat per-type list, not a tree of storage extents.
 *
 * A Fallout map stores scripts in a linked list of fixed 16-slot pages ("extents"); the page boundary plus the
 * trailing Extent Length / Extent Next pointers are file-storage paging, not gameplay structure. The display
 * projection lifts every slot out of its extent into one continuous "Script N" list per type (System / Spatial
 * / Timer / Item) and drops the paging fields, mirroring how the Objects section lifts per-elevation object
 * arrays. Round-trip is unaffected (the canonical document keeps the extents; only the display flattens).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { projectRow } from "../src/window";

const FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/newr2.map");

function mapModel() {
    return buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(FIXTURE))));
}

function nonEmptyScriptSection(m: ReturnType<typeof mapModel>) {
    return m.nodes.find((n) => (n.name ?? "").endsWith("Scripts") && m.nodes.some((c) => c.parentId === n.id));
}

describe("MAP scripts: flat per-type list (extents hidden)", () => {
    it("lifts slots out of extents into a flat 'Script N' list", () => {
        const m = mapModel();
        const section = nonEmptyScriptSection(m);
        expect(section, "newr2 has a non-empty script section").toBeDefined();
        const children = m.nodes.filter((n) => n.parentId === section!.id);
        expect(children.length).toBeGreaterThan(0);
        expect(
            children.every((c) => /^Script \d+$/.test(c.name ?? "")),
            `script children should all be flat slots: ${children.map((c) => c.name).join(", ")}`,
        ).toBe(true);
    });

    it("hides the storage-paging structure (no Extent group, Length, or Next)", () => {
        const m = mapModel();
        expect(m.nodes.some((n) => (n.name ?? "").startsWith("Extent"))).toBe(false);
    });

    it("shows the script SID as a hex field whose label is stripped of the 'Entry N' prefix", () => {
        const m = mapModel();
        const section = nonEmptyScriptSection(m)!;
        const firstScript = m.nodes.find((n) => n.parentId === section.id)!;
        const sid = m.nodes.find((n) => n.parentId === firstScript.id && /SID/i.test(n.name ?? ""));
        expect(sid, "script detail has a SID field").toBeDefined();
        // "Entry N " prefix stripped -> the label is just "SID" (the master entry already says "Script N").
        expect(sid!.name).toBe("SID");
        // Packed (type<<24 | index) dword shown in hex, like object FID/PID.
        expect(projectRow(m, sid!).numericFormat).toBe("hex32");
    });

    it("shows the script Owner ID as a hex field (packed object reference / sentinel)", () => {
        const m = mapModel();
        const section = nonEmptyScriptSection(m)!;
        const firstScript = m.nodes.find((n) => n.parentId === section.id)!;
        const owner = m.nodes.find((n) => n.parentId === firstScript.id && /Owner ID/i.test(n.name ?? ""));
        expect(owner, "script detail has an Owner ID field").toBeDefined();
        // The owner is an object self-id using the same (type<<24 | index) packing as SID/FID/PID, and is often
        // a sentinel (-1 "none", -2, 0xCCCCCCCC uninitialized). Hex shows the type byte and avoids confusing
        // signed-decimal sentinels (e.g. 0xCCCCCCCC rendering as -858993460).
        expect(projectRow(m, owner!).numericFormat).toBe("hex32");
    });

    it("labels the Action Being Used -1 sentinel as 'None' (no skill active), not Unknown", () => {
        const m = mapModel();
        const section = nonEmptyScriptSection(m)!;
        // Find any script whose Action Being Used is the -1 sentinel (the common "no skill" case).
        const scripts = m.nodes.filter((n) => n.parentId === section.id);
        let opts: Readonly<Record<string, string>> | undefined;
        for (const s of scripts) {
            const f = m.nodes.find((n) => n.parentId === s.id && /Action Being Used/i.test(n.name ?? ""));
            if (f && projectRow(m, f).rawValue === -1) {
                opts = projectRow(m, f).enumOptions;
                break;
            }
        }
        expect(opts, "a script with Action Being Used = -1 exists").toBeDefined();
        expect(opts!["-1"]).toBe("None");
    });
});
