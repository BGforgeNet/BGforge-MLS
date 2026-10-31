/**
 * The MAP parser finds its own fields by their declared keys, so relabelling a field changes the display tree and
 * nothing else. Graceful parsing is the path that reads its own output back (boundary scoring checks the first
 * object's rotation, elevation, PID and SID, and the section counts) before the canonical reader does, so a
 * lookup still keyed by the old label shows here as an opaque objects section.
 *
 * The relabelled presentation is substituted at module level because that is where a relabel lands; the oracle is
 * the committed snapshot of the same map, written with the shipped labels.
 */

import * as fs from "fs";
import * as path from "path";
import { describe, expect, it, vi } from "vitest";
import { mapParser } from "../src/map";
import { createMapCanonicalSnapshot } from "../src/map/canonical";
import { buildFileDerivedParseOptions } from "../src/parse-options";
import { loadMap, resolveMapPath } from "./map-fixtures";
import { REPO_ROOT } from "./repo-root";

vi.mock("../src/map/specs/object", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/map/specs/object")>();
    return {
        ...actual,
        objectBasePresentation: {
            ...actual.objectBasePresentation,
            rotation: { label: "Facing" },
            elevation: { label: "Level" },
            pid: { ...actual.objectBasePresentation.pid, label: "Prototype" },
            sid: { ...actual.objectBasePresentation.sid, label: "Script" },
        },
    };
});

vi.mock("../src/map/specs/sections", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../src/map/specs/sections")>();
    return {
        ...actual,
        objectsSectionPresentation: { totalObjects: { label: "Objects In Map" } },
        elevationObjectsPresentation: { objectCount: { label: "Objects Here" } },
        scriptListPresentation: { scriptCount: { label: "Scripts Listed" } },
        scriptExtentPresentation: { extentLength: { label: "Slots Used" }, extentNext: { label: "Next Extent" } },
    };
});

interface Node {
    name: string;
    fields?: Node[];
}

function labels(node: Node): string[] {
    return [node.name, ...(node.fields ?? []).flatMap((child) => labels(child))];
}

interface MapDocumentShape {
    objects: {
        totalObjects: number;
        elevations: { objectCount: number; objects: { base: { pid: number; sid: number } }[] }[];
    };
    scripts: { count: number; extents: { extentLength: number; extentNext: number }[] }[];
}

/**
 * What the relabelled lookups decide: the object and script sections. The committed snapshot predates the
 * flag-array projection of `flags` and naming script lists by SID type, so the comparison keeps to fields those
 * changes left alone.
 */
function decoded(document: unknown): unknown {
    const { objects, scripts } = document as MapDocumentShape;
    return {
        totalObjects: objects.totalObjects,
        elevations: objects.elevations.map((e) => ({
            objectCount: e.objectCount,
            objects: e.objects.map((o) => [o.base.pid, o.base.sid]),
        })),
        scripts: scripts.map((s) => [s.count, s.extents.map((x) => [x.extentLength, x.extentNext])]),
    };
}

describe("MAP parsing under relabelled fields", () => {
    it("decodes artemple.map as the shipped labels do", () => {
        // The committed snapshot was written against the sibling proto tree, which decodes every object.
        const mapPath = resolveMapPath("artemple.map");
        const bytes = loadMap(mapPath);
        const { pidResolver } = buildFileDerivedParseOptions(mapPath);
        const expected = JSON.parse(
            fs.readFileSync(path.join(REPO_ROOT, "client/testFixture/maps/artemple.json"), "utf-8"),
        ) as { document: unknown };

        const result = mapParser.parse(bytes, { gracefulMapBoundaries: true, pidResolver });

        const tree = labels(result.root);
        expect(tree).toEqual(
            expect.arrayContaining([
                "Facing",
                "Level",
                "Prototype",
                "Script",
                "Objects In Map",
                "Objects Here",
                "Scripts Listed",
                "Slots Used",
                "Next Extent",
            ]),
        );
        expect(
            tree.filter((label) => ["Rotation", "Total Objects", "Object Count", "Extent Length"].includes(label)),
        ).toEqual([]);
        expect(result.errors).toBeUndefined();
        const snapshot = createMapCanonicalSnapshot(result);
        expect(decoded(snapshot.document)).toEqual(decoded(expected.document));
        // No objects-tail: scoring took the objects section as confidently decoded.
        expect(snapshot.opaqueRanges?.map((range) => range.label)).toEqual(["header-padding"]);
        expect(Buffer.from(mapParser.serialize!(result)).equals(Buffer.from(bytes))).toBe(true);
    });
});
