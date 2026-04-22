/**
 * Unit tests for PRO binary parser.
 * Loads all fixture .pro files, parses them, and asserts against JSON snapshots.
 * Establishes a safety net before swapping the underlying binary parsing library.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

import { parseBinaryJsonSnapshot } from "../src/parsers/json-snapshot";
import { proParser } from "../src/parsers/pro";

const FIXTURES = path.resolve("client/testFixture/proto");

/** Strip undefined values to match JSON.parse round-trip behavior */
function jsonClean(obj: unknown): unknown {
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
const goodFixtures = GOOD_DIRS.flatMap(dir => loadFixtures(dir));

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

    it("reports invalid enum values as errors", () => {
        const proPath = path.join(FIXTURES, "bad", "bad-material.pro");
        if (!fs.existsSync(proPath)) return;
        const data = new Uint8Array(fs.readFileSync(proPath));
        const result = proParser.parse(data);
        expect(result.errors).toBeDefined();
        expect(result.errors!.some((e) => e.includes("Invalid"))).toBe(true);
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
