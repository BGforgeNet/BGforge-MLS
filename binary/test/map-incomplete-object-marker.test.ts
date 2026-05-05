/**
 * Incomplete-object marker on the parsed display tree.
 *
 * Item and Scenery records carry a subtype-keyed trailer whose layout depends
 * on the referenced `.pro`. The bundled `pid → subType` table resolves vanilla
 * pids; for modded or unknown pids the resolver returns `undefined` and the
 * parser falls back to its legacy bail. The bailed group's already-decoded
 * fields still render so the user can inspect them, but the enclosing group
 * is marked `editingLocked` — field edits are unsafe when the trailing-byte
 * width is unknown (changing `inventoryLength` or the upper byte of `pid`
 * would re-interpret the opaque trailer on reparse). Wall / Tile records
 * have no subtype trailer (fallout2-ce's `objectDataRead` switch doesn't
 * branch on them) and therefore parse cleanly.
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

    it("Item / Scenery groups are flagged when the resolver returns undefined for their pid", () => {
        // Force every item/scenery pid into the unresolved branch by supplying
        // a resolver that always returns undefined. The first item/scenery the
        // parser hits will then bail with editingLocked set, identical to the
        // pre-resolver behavior.
        const data = new Uint8Array(fs.readFileSync(arcavesPath));
        const parsed = mapParser.parse(data, { pidResolver: () => undefined });

        const scenery = findFirstGroupMatching(parsed.root, (g) => /^Object \d+\.\d+ \(Scenery\)$/.test(g.name));
        expect(scenery, "expected at least one Scenery object in arcaves elev 0").toBeDefined();
        expect(scenery?.editingLocked).toBe(true);
    });

    it("Item / Scenery groups stay unlocked when the resolver decodes their trailer", () => {
        // The bundled fallout2-pidtypes.json resolves arcaves' first scenery
        // (subType 5 / Generic, 0-byte trailer) so the parser advances cleanly.
        const data = new Uint8Array(fs.readFileSync(arcavesPath));
        const parsed = mapParser.parse(data);

        const scenery = findFirstGroupMatching(parsed.root, (g) => /^Object \d+\.\d+ \(Scenery\)$/.test(g.name));
        expect(scenery, "expected at least one Scenery object in arcaves elev 0").toBeDefined();
        expect(scenery?.editingLocked ?? false).toBe(false);
    });

    it("Object N.M (Misc|Critter) groups stay unlocked when the parser fully decoded them", () => {
        const data = new Uint8Array(fs.readFileSync(arcavesPath));
        const parsed = mapParser.parse(data);

        const misc = findFirstGroupMatching(parsed.root, (g) => /^Object \d+\.\d+ \(Misc\)$/.test(g.name));
        expect(misc, "expected at least one Misc object in arcaves elev 0").toBeDefined();
        expect(misc?.editingLocked ?? false).toBe(false);
    });
});
