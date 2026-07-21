import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { formatAdapterRegistry, type ProjectedEntry } from "../src/format-adapter";
import { mapParser } from "../src/map";
import type { ParsedField, ParsedGroup, ParseResult } from "../src/types";
import { REPO_ROOT } from "./repo-root";

// Resolve the adapter through the registry (not a direct module import) so the
// registry's eager adapter registration runs first - a direct import of
// map/format-adapter trips the registry<->adapter module cycle in isolation.
const mapFormatAdapter = formatAdapterRegistry.get("map")!;

const DENBUS1 = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/maps/denbus1.map");
const hasFixture = fs.existsSync(DENBUS1);

function isGroup(e: ParsedField | ParsedGroup): e is ParsedGroup {
    return "fields" in e;
}

// Minimal identity projection, mirroring the editor harness, so the adapter can
// be exercised library-side without the editor.
function projectChild(entry: ParsedField | ParsedGroup, segs: readonly string[]): ProjectedEntry {
    if (isGroup(entry)) {
        return {
            kind: "group",
            entry,
            sourceSegments: segs,
            children: entry.fields.map((c) => projectChild(c, [...segs, c.name])),
        };
    }
    return { kind: "field", entry, sourceSegments: segs };
}

const projectEntry = (_pr: ParseResult, entry: ParsedField | ParsedGroup, segs: readonly string[]): ProjectedEntry =>
    projectChild(entry, segs);

describe.skipIf(!hasFixture)("map projectDisplayRoot objects", () => {
    it("lifts each elevation's objects to a top-level list section and adds a read-only Objects form", () => {
        const data = new Uint8Array(fs.readFileSync(DENBUS1));
        const pr = mapParser.parse(data, { gracefulMapBoundaries: true });
        const roots = mapFormatAdapter.projectDisplayRoot!(pr, projectEntry);
        const names = roots.map((r) => r.entry.name);

        expect(names).not.toContain("Objects Section");
        expect(names).toContain("Elevation 0 Objects");
        expect(names).toContain("Objects"); // read-only counts form

        const elev0 = roots.find((r) => r.entry.name === "Elevation 0 Objects");
        expect(elev0?.kind).toBe("group");
        // Children are object groups only (no "Object Count" field).
        const childNames = elev0!.kind === "group" ? elev0!.children.map((c) => c.entry.name) : [];
        expect(childNames.every((n) => n !== "Object Count")).toBe(true);
        expect(childNames.some((n) => /^Object 0\.\d+ /.test(n))).toBe(true);

        const objectsForm = roots.find((r) => r.entry.name === "Objects");
        expect(objectsForm?.kind === "group" && (objectsForm.entry as ParsedGroup).editingLocked).toBe(true);
        // The counts form surfaces Total Objects + per-elevation counts read-only.
        const formChildren = objectsForm!.kind === "group" ? objectsForm!.children.map((c) => c.entry.name) : [];
        expect(formChildren).toContain("Total Objects");
        expect(formChildren).toContain("Elevation 0 Object Count");
    });

    it("keeps the Tiles collapse (single empty Tiles placeholder) intact", () => {
        const data = new Uint8Array(fs.readFileSync(DENBUS1));
        const pr = mapParser.parse(data, { gracefulMapBoundaries: true });
        const roots = mapFormatAdapter.projectDisplayRoot!(pr, projectEntry);
        const tiles = roots.filter((r) => r.entry.name === "Tiles");
        expect(tiles).toHaveLength(1);
        expect(tiles[0]!.kind === "group" && tiles[0]!.children.length).toBe(0);
    });
});
