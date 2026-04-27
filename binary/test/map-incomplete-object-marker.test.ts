/**
 * Incomplete-object marker on the parsed display tree.
 *
 * Object records of types Item / Scenery / Wall / Tile carry a subtype payload
 * whose layout is described by the corresponding `.pro` file. When PROs aren't
 * available the parser stops at the data-header boundary; the partially-decoded
 * record still appears in the display tree (so the user can see what's there)
 * but its enclosing group is marked `editingLocked` so editors won't expose
 * field edits on it. Editing fields on such a record is unsafe — changing
 * `inventoryLength` or the upper byte of `pid` (the type tag) would change how
 * downstream opaque-trailer bytes get interpreted on reparse, silently
 * corrupting the file.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { mapParser } from "../src/map";
import type { ParsedGroup } from "../src/types";

function isGroup(x: unknown): x is ParsedGroup {
    return typeof x === "object" && x !== null && "fields" in x && Array.isArray((x as ParsedGroup).fields);
}

function findFirstGroupMatching(root: ParsedGroup, predicate: (g: ParsedGroup) => boolean): ParsedGroup | undefined {
    if (predicate(root)) return root;
    for (const field of root.fields) {
        if (isGroup(field)) {
            const nested = findFirstGroupMatching(field, predicate);
            if (nested) return nested;
        }
    }
    return undefined;
}

describe("incomplete-object groups carry editingLocked", () => {
    const arcavesPath = path.resolve("client/testFixture/maps/arcaves.map");

    it("Object N.M (Scenery|Item|Wall|Tile) groups are flagged", () => {
        const data = new Uint8Array(fs.readFileSync(arcavesPath));
        const parsed = mapParser.parse(data);

        const scenery = findFirstGroupMatching(parsed.root, (g) => /^Object \d+\.\d+ \(Scenery\)$/.test(g.name));
        expect(scenery, "expected at least one Scenery object in arcaves elev 0").toBeDefined();
        expect(scenery?.editingLocked).toBe(true);
    });

    it("Object N.M (Misc|Critter) groups stay unlocked when the parser fully decoded them", () => {
        const data = new Uint8Array(fs.readFileSync(arcavesPath));
        const parsed = mapParser.parse(data);

        const misc = findFirstGroupMatching(parsed.root, (g) => /^Object \d+\.\d+ \(Misc\)$/.test(g.name));
        expect(misc, "expected at least one Misc object in arcaves elev 0").toBeDefined();
        expect(misc?.editingLocked ?? false).toBe(false);
    });
});
