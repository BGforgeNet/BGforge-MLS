/**
 * Unit tests for PRO binary parser.
 * Loads all fixture .pro files, parses them, and asserts against JSON snapshots.
 * Establishes a safety net before swapping the underlying binary parsing library.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { parseBinaryJsonSnapshot } from "../src/json-snapshot";
import { proParser } from "../src/pro";
import type { ParseResult } from "../src/types";

const FIXTURES = path.resolve("client/testFixture/proto");

/** Strip undefined values to match JSON.parse round-trip behavior */
function jsonClean(obj: unknown): unknown {
    // Intentional JSON round-trip: drops `undefined` values to match the
    // deserialised fixture shape. `structuredClone` would preserve them.
    // eslint-disable-next-line unicorn/prefer-structured-clone
    return JSON.parse(JSON.stringify(obj));
}

/** Load all .pro files in a subdirectory, paired with their .json snapshots */
function loadFixtures(subDir: string): Array<{ name: string; proPath: string; jsonPath: string }> {
    const dir = path.join(FIXTURES, subDir);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".pro"))
        .map((f) => ({
            name: `${subDir}/${f}`,
            proPath: path.join(dir, f),
            jsonPath: path.join(dir, f.replace(/\.pro$/, ".pro.json")),
        }))
        .filter((entry) => fs.existsSync(entry.jsonPath));
}

const GOOD_DIRS = ["misc", "walls", "tiles", "critters", "scenery", "items"];
const goodFixtures = GOOD_DIRS.flatMap((dir) => loadFixtures(dir));

describe("PRO parser - good fixtures", () => {
    it.each(goodFixtures)("parses $name correctly", ({ proPath, jsonPath }) => {
        const proData = new Uint8Array(fs.readFileSync(proPath));
        const expected = parseBinaryJsonSnapshot(fs.readFileSync(jsonPath, "utf-8"));

        const result = proParser.parse(proData);
        expect(jsonClean(result)).toEqual(expected);
    });

    it("attaches a canonical PRO document alongside the editor tree", () => {
        const proPath = path.join(FIXTURES, "misc", "00000001.pro");
        const result = proParser.parse(new Uint8Array(fs.readFileSync(proPath))) as ParseResult & {
            document?: {
                header?: { objectType: number; objectId: number; textId: number };
                sections?: { miscProperties?: { unknown: number } };
            };
        };

        expect(result.document).toMatchObject({
            header: {
                objectType: 5,
                objectId: 1,
                textId: 100,
            },
            sections: {
                miscProperties: {
                    unknown: 0,
                },
            },
        });
    });
});

describe("PRO parser - error cases", () => {
    it("rejects files that are too small", () => {
        const proPath = path.join(FIXTURES, "bad", "too-small.pro");
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeDefined();
        expect(result.errors!.length).toBeGreaterThan(0);
        expect(result.errors![0]).toContain("too small");
    });

    it("rejects files with unknown object type", () => {
        const proPath = path.join(FIXTURES, "bad", "unknown-type.pro");
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("Unknown object type");
    });

    it("rejects truncated critter files", () => {
        const proPath = path.join(FIXTURES, "bad", "truncated-critter.pro");
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("size");
    });

    it("rejects wall files with wrong size", () => {
        const proPath = path.join(FIXTURES, "bad", "wrong-size-wall.pro");
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("size");
    });

    it("displays out-of-range enum values as 'Unknown (N)' without erroring", () => {
        // Reading a structurally-sound file always surfaces a display tree;
        // values outside an enum table render as `Unknown (N)` rather than
        // failing parse. Schema-level rejection happens on save (see
        // canonical-writer / zod refinement).
        const proPath = path.join(FIXTURES, "bad", "bad-material.pro");
        if (!fs.existsSync(proPath)) return;
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeUndefined();
        const flat = JSON.stringify(result.root);
        expect(flat).toContain("Unknown (99)");
    });

    it("rejects empty files", () => {
        const result = proParser.parse(new Uint8Array(0));
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("too small");
    });

    it("rejects oversized files", () => {
        const result = proParser.parse(new Uint8Array(2048));
        expect(result.errors).toBeDefined();
        expect(result.errors![0]).toContain("too large");
    });
});

// Regression for the proto-default sentinel pattern: the engine's
// proto_scenery_subdata_init seeds elevator type/level to -1 (proto.cc:976)
// and proto_scenery_init seeds material to -1 (proto.cc:956). Vanilla protos
// that never override those defaults reach disk with `0xff_ff_ff_ff` on the
// wire; the parser must surface them as `-1` rather than rejecting the file.
describe("PRO parser - proto-default sentinels", () => {
    function buildElevatorScenery(elevatorType: number, elevatorLevel: number, materialId: number): Uint8Array {
        // 24 (header) + 17 (scenery-common) + 8 (elevator subdata) = 49 bytes.
        const b = new Uint8Array(49);
        const view = new DataView(b.buffer);
        view.setUint8(0, 2); // objectType = Scenery
        view.setUint8(1, 0x00);
        view.setUint8(2, 0x05);
        view.setUint8(3, 0x0d); // objectId = 1293 (24-bit BE)
        view.setUint32(4, 129300, false); // textId
        view.setUint8(8, 2); // frmType = Scenery
        view.setInt8(28, -1); // scriptType
        view.setUint8(29, 0xff);
        view.setUint8(30, 0xff);
        view.setUint8(31, 0xff); // scriptId i24=-1
        view.setUint32(32, 2, false); // sceneryProperties.subType = Elevator
        view.setInt32(36, materialId, false);
        view.setUint8(40, 48); // soundId
        view.setInt32(41, elevatorType, false);
        view.setInt32(45, elevatorLevel, false);
        return b;
    }

    it("accepts elevator scenery with elevatorType/Level = -1 and material = -1", () => {
        const data = buildElevatorScenery(-1, -1, -1);
        const result = proParser.parse(data) as ParseResult & {
            document?: { sections: Record<string, Record<string, number>> };
        };
        expect(result.errors).toBeUndefined();
        expect(result.document?.sections.elevatorProperties).toEqual({
            elevatorType: -1,
            elevatorLevel: -1,
        });
        expect(result.document?.sections.sceneryProperties?.materialId).toBe(-1);
    });

    // Permissive canonical-doc creation: even when an out-of-enum value lands
    // on disk (modder-set, prerelease tooling, hand-edited mod), the canonical
    // doc must still build so the editor can render and snapshots can be
    // dumped. Strict refinement only fires when serialising back to bytes.
    it("builds canonical doc for elevator scenery with out-of-enum elevatorType", () => {
        const data = buildElevatorScenery(99, 0, 1);
        const result = proParser.parse(data) as ParseResult & {
            document?: { sections: Record<string, Record<string, number>> };
        };
        expect(result.errors).toBeUndefined();
        expect(result.document).toBeDefined();
        expect(result.document?.sections.elevatorProperties?.elevatorType).toBe(99);
    });
});
