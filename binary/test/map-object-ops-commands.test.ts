/**
 * Model-based (fc.commands) test for the MAP object structure ops.
 *
 * The per-operation cases in map-object-ops.test.ts each start from a pristine parse of the fixture.
 * The editor does not: it applies a sequence of structure ops, re-parsing its own output each time.
 * This drives random sequences of the object and inventory ops and re-checks, after EVERY command,
 * the invariants a save depends on:
 *
 *   1. Round-trip - the emitted bytes re-parse without error and the re-parsed document's per-elevation
 *      object ids, script links and inventory sizes equal the ones the sequence predicted.
 *   2. No dangling reference - `totalObjects` and each `objectCount` agree with the arrays they count,
 *      and no surviving object's script link moved.
 *
 * cave6.map is the fixture because it decodes its objects fully (no opaque objects tail), so the ops
 * are not refused; the sibling file documents that selection.
 */

import fs from "node:fs";
import path from "node:path";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mapParser } from "../src/map";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "../src/map/canonical-reader";
import {
    buildMapObjectAddEntryBytes,
    buildMapObjectDuplicateEntryBytes,
    buildMapObjectInsertEntryBytes,
    buildMapObjectInventoryAddBytes,
    buildMapObjectInventoryRemoveBytes,
    buildMapObjectMoveEntryBytes,
    buildMapObjectRemoveEntryBytes,
} from "../src/map/object-ops";
import type { ParseResult } from "../src/types";
import { REPO_ROOT } from "./repo-root";

const FIXTURE = path.join(REPO_ROOT, "external/fallout/Fallout2_Restoration_Project/data/maps/cave6.map");
const hasFixture = fs.existsSync(FIXTURE);

const PARSE_OPTIONS = { gracefulMapBoundaries: true } as const;

/** `defaultMapObject` leaves the script link unset, so a freshly added object carries this index. */
const NEW_OBJECT_SCRIPT_INDEX = 0;

type MapDoc = NonNullable<ReturnType<typeof getMapCanonicalDocument>>;

function docOf(pr: ParseResult): MapDoc {
    const doc = getMapCanonicalDocument(pr) ?? rebuildMapCanonicalDocument(pr);
    if (!doc) throw new Error("no MAP document");
    return doc;
}

/**
 * The part of a document a save must preserve: per elevation, each object's id, its script link and
 * its inventory size, in order. The script link is here because it is the one cross-section reference
 * an object carries: an op that renumbered or re-anchored it would leave the object pointing at
 * another object's script.
 */
interface ElevationShape {
    readonly ids: number[];
    readonly scripts: number[];
    readonly inventory: number[];
}

function project(doc: MapDoc): ElevationShape[] {
    return doc.objects.elevations.map((e) => ({
        ids: e.objects.map((o) => o.base.id),
        scripts: e.objects.map((o) => o.base.scriptIndex),
        inventory: e.objects.map((o) => o.inventory.length),
    }));
}

/**
 * Object ids are NOT unique in real Fallout 2 maps (cave6.map reuses them heavily), so uniqueness is
 * not an invariant to assert; what the ops promise is that a NEW object gets max+1, which the
 * predicted shape below pins.
 */
function checkInvariants(doc: MapDoc): void {
    let total = 0;
    for (const elevation of doc.objects.elevations) {
        expect(elevation.objectCount).toBe(elevation.objects.length);
        total += elevation.objects.length;
    }
    expect(doc.objects.totalObjects).toBe(total);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Real system under test: the parse result the editor re-derives from its own emitted bytes. */
interface Real {
    pr: ParseResult;
    doc: MapDoc;
}

/** Abstract state: enough to gate a command's preconditions (which indexes are in range). */
interface Abstract {
    elevations: { objects: number; inventory: number[] }[];
}

type Cmd = fc.Command<Abstract, Real>;

function sync(m: Abstract, r: Real): void {
    m.elevations = r.doc.objects.elevations.map((e) => ({
        objects: e.objects.length,
        inventory: e.objects.map((o) => o.inventory.length),
    }));
}

const sectionOf = (elev: number): string[] => [`Elevation ${elev} Objects`];

/**
 * A command whose `run` applies one op, re-parses the emitted bytes, and re-checks both invariants
 * against the shape the same mutation predicts on the previous document.
 */
function command(
    label: string,
    check: (m: Abstract) => boolean,
    build: (r: Real) => Uint8Array | undefined,
    predict: (before: ElevationShape[], r: Real) => ElevationShape[],
): Cmd {
    return {
        check,
        run(m: Abstract, r: Real): void {
            const before = project(r.doc);
            const expected = predict(before, r);
            const bytes = build(r);
            expect(bytes).toBeDefined();
            const next = mapParser.parse(bytes!, PARSE_OPTIONS);
            expect(next.errors ?? []).toEqual([]);
            r.pr = next;
            r.doc = docOf(next);
            checkInvariants(r.doc);
            expect(project(r.doc)).toEqual(expected);
            sync(m, r);
        },
        toString: () => label,
    };
}

/** The id add/insert/duplicate mints for a new object: one past the highest in the whole document. */
function freshId(shapes: ElevationShape[]): number {
    return Math.max(0, ...shapes.flatMap((e) => e.ids)) + 1;
}

function replace(shapes: ElevationShape[], elev: number, next: ElevationShape): ElevationShape[] {
    return shapes.map((e, i) => (i === elev ? next : e));
}

const pick = (length: number, at: number): number => at % length;

function addObject(elev: number): Cmd {
    return command(
        `addObject(${elev})`,
        (m) => m.elevations[elev] !== undefined,
        (r) => buildMapObjectAddEntryBytes(r.pr, sectionOf(elev)),
        (before) => {
            const e = before[elev]!;
            return replace(before, elev, {
                ids: [...e.ids, freshId(before)],
                scripts: [...e.scripts, NEW_OBJECT_SCRIPT_INDEX],
                inventory: [...e.inventory, 0],
            });
        },
    );
}

function insertObject(elev: number, at: number, position: "before" | "after"): Cmd {
    return command(
        `insertObject(${elev}, ${at}, ${position})`,
        (m) => (m.elevations[elev]?.objects ?? 0) > 0,
        (r) =>
            buildMapObjectInsertEntryBytes(
                r.pr,
                sectionOf(elev),
                pick(r.doc.objects.elevations[elev]!.objects.length, at),
                position,
            ),
        (before) => {
            const e = before[elev]!;
            const index = pick(e.ids.length, at) + (position === "after" ? 1 : 0);
            return replace(before, elev, {
                ids: [...e.ids.slice(0, index), freshId(before), ...e.ids.slice(index)],
                scripts: [...e.scripts.slice(0, index), NEW_OBJECT_SCRIPT_INDEX, ...e.scripts.slice(index)],
                inventory: [...e.inventory.slice(0, index), 0, ...e.inventory.slice(index)],
            });
        },
    );
}

function removeObject(elev: number, at: number): Cmd {
    return command(
        `removeObject(${elev}, ${at})`,
        (m) => (m.elevations[elev]?.objects ?? 0) > 1,
        (r) =>
            buildMapObjectRemoveEntryBytes(
                r.pr,
                sectionOf(elev),
                pick(r.doc.objects.elevations[elev]!.objects.length, at),
            ),
        (before) => {
            const e = before[elev]!;
            const index = pick(e.ids.length, at);
            const drop = <T>(xs: T[]): T[] => xs.filter((_, i) => i !== index);
            return replace(before, elev, { ids: drop(e.ids), scripts: drop(e.scripts), inventory: drop(e.inventory) });
        },
    );
}

function moveObject(elev: number, at: number, direction: "up" | "down"): Cmd {
    return command(
        `moveObject(${elev}, ${at}, ${direction})`,
        (m) => (m.elevations[elev]?.objects ?? 0) > 1,
        (r) => {
            const count = r.doc.objects.elevations[elev]!.objects.length;
            // Anchor away from the boundary the direction cannot cross: a boundary move is a
            // documented no-op that returns undefined, which `command` reads as a failure.
            const index = direction === "up" ? 1 + (at % (count - 1)) : at % (count - 1);
            return buildMapObjectMoveEntryBytes(r.pr, sectionOf(elev), index, direction);
        },
        (before) => {
            const e = before[elev]!;
            const count = e.ids.length;
            const index = direction === "up" ? 1 + (at % (count - 1)) : at % (count - 1);
            const other = direction === "up" ? index - 1 : index + 1;
            const swap = <T>(xs: T[]): T[] => {
                const next = [...xs];
                [next[index], next[other]] = [next[other]!, next[index]!];
                return next;
            };
            return replace(before, elev, { ids: swap(e.ids), scripts: swap(e.scripts), inventory: swap(e.inventory) });
        },
    );
}

function duplicateObject(elev: number, at: number): Cmd {
    return command(
        `duplicateObject(${elev}, ${at})`,
        (m) => (m.elevations[elev]?.objects ?? 0) > 0,
        (r) =>
            buildMapObjectDuplicateEntryBytes(
                r.pr,
                sectionOf(elev),
                pick(r.doc.objects.elevations[elev]!.objects.length, at),
            ),
        (before) => {
            const e = before[elev]!;
            const index = pick(e.ids.length, at);
            const clone = <T>(xs: T[], value: T): T[] => [...xs.slice(0, index + 1), value, ...xs.slice(index + 1)];
            return replace(before, elev, {
                ids: clone(e.ids, freshId(before)),
                scripts: clone(e.scripts, e.scripts[index]!),
                inventory: clone(e.inventory, e.inventory[index]!),
            });
        },
    );
}

function addInventory(elev: number, at: number): Cmd {
    return command(
        `addInventory(${elev}, ${at})`,
        (m) => (m.elevations[elev]?.objects ?? 0) > 0,
        (r) =>
            buildMapObjectInventoryAddBytes(
                r.pr,
                sectionOf(elev),
                pick(r.doc.objects.elevations[elev]!.objects.length, at),
            ),
        (before) => {
            const e = before[elev]!;
            const index = pick(e.ids.length, at);
            return replace(before, elev, {
                ids: e.ids,
                scripts: e.scripts,
                inventory: e.inventory.map((n, i) => (i === index ? n + 1 : n)),
            });
        },
    );
}

function removeInventory(elev: number, at: number): Cmd {
    /** One of the objects that actually has an inventory entry to remove; the precondition guarantees one. */
    const objectWithInventory = (inventory: readonly number[]): number => {
        const candidates = inventory.flatMap((n, i) => (n > 0 ? [i] : []));
        return candidates[at % candidates.length]!;
    };
    return command(
        `removeInventory(${elev}, ${at})`,
        (m) => (m.elevations[elev]?.inventory ?? []).some((n) => n > 0),
        (r) => {
            const inventory = r.doc.objects.elevations[elev]!.objects.map((o) => o.inventory.length);
            const index = objectWithInventory(inventory);
            return buildMapObjectInventoryRemoveBytes(r.pr, sectionOf(elev), index, inventory[index]! - 1);
        },
        (before) => {
            const e = before[elev]!;
            const index = objectWithInventory(e.inventory);
            return replace(before, elev, {
                ids: e.ids,
                scripts: e.scripts,
                inventory: e.inventory.map((n, i) => (i === index ? n - 1 : n)),
            });
        },
    );
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

const elevationsWithObjects = (doc: MapDoc): number[] =>
    doc.objects.elevations.flatMap((e, i) => (e.objects.length > 0 ? [i] : []));

describe.skipIf(!hasFixture)("map object-ops under sequences of edits", () => {
    const bytes = hasFixture ? new Uint8Array(fs.readFileSync(FIXTURE)) : new Uint8Array();
    const basePr = hasFixture ? mapParser.parse(bytes, PARSE_OPTIONS) : undefined;
    const baseDoc = basePr ? docOf(basePr) : undefined;
    const elev = baseDoc ? elevationsWithObjects(baseDoc)[0] : undefined;

    it("has a fully-decoded elevation with objects to exercise", () => {
        // Positive control: every sequence below is vacuous if the fixture decodes to nothing.
        expect(elev).toBeDefined();
        expect(baseDoc!.objects.elevations[elev!]!.objects.length).toBeGreaterThan(1);
    });

    // Its own budget rather than the suite's: every command re-parses a whole MAP, and the parallel
    // coverage phase in CI slows that work past the suite default while the test is still progressing.
    it("keeps every edit sequence count-consistent and round-trippable", { timeout: 180_000 }, () => {
        const index = fc.nat({ max: 8 });
        const position = fc.constantFrom<"before" | "after">("before", "after");
        const direction = fc.constantFrom<"up" | "down">("up", "down");
        const commands: fc.Arbitrary<Cmd>[] = [
            fc.constant(addObject(elev!)),
            fc.tuple(index, position).map(([at, p]) => insertObject(elev!, at, p)),
            index.map((at) => removeObject(elev!, at)),
            fc.tuple(index, direction).map(([at, d]) => moveObject(elev!, at, d)),
            index.map((at) => duplicateObject(elev!, at)),
            index.map((at) => addInventory(elev!, at)),
            index.map((at) => removeInventory(elev!, at)),
        ];

        fc.assert(
            fc.property(fc.commands(commands, { maxCommands: 4 }), (cmds) => {
                fc.modelRun(() => {
                    // Every run starts from the one fixture parse: the builders only read the parse result
                    // and each command replaces `real`'s fields rather than mutating them.
                    const real: Real = { pr: basePr!, doc: baseDoc! };
                    const model: Abstract = { elevations: [] };
                    sync(model, real);
                    return { model, real };
                }, cmds);
            }),
            // Each command re-serializes and re-parses a whole MAP, so the sequences stay short.
            { numRuns: 8 },
        );
    });
});
