/**
 * Round-trip tests for PRO binary parser + serializer.
 * Reads .pro fixture bytes, parses via typed-binary schema,
 * writes back, and asserts output bytes are identical to input.
 * Proves the write path is correct — foundation for the editor.
 */

import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { BufferReader, BufferWriter } from "typed-binary";
import { createBinaryJsonSnapshot } from "../src/json-snapshot";
import { proParser } from "../src/pro";
import {
    headerSchema,
    itemCommonSchema,
    armorSchema,
    containerSchema,
    drugSchema,
    weaponSchema,
    ammoSchema,
    miscItemSchema,
    keySchema,
    critterSchema,
    sceneryCommonSchema,
    doorSchema,
    stairsSchema,
    elevatorSchema,
    ladderSchema,
    genericScenerySchema,
    wallSchema,
    tileSchema,
    miscSchema,
} from "../src/pro/schemas";
import { HEADER_SIZE, ITEM_SUBTYPE_OFFSET, SCENERY_SUBTYPE_OFFSET } from "../src/pro/types";

const FIXTURES = path.resolve("client/testFixture/proto");

function reader(data: Uint8Array, offset = 0): BufferReader {
    return new BufferReader(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

function writer(data: Uint8Array, offset = 0): BufferWriter {
    return new BufferWriter(data.buffer, { endianness: "big", byteOffset: data.byteOffset + offset });
}

/** Read a PRO file, parse each section, write back, return the output buffer */
function roundTrip(input: Uint8Array): Uint8Array {
    const output = new Uint8Array(input.length);

    // Header
    const header = headerSchema.read(reader(input));
    headerSchema.write(writer(output), header);

    const objectType = header.objectType;

    switch (objectType) {
        case 0: {
            // Item
            const itemCommon = itemCommonSchema.read(reader(input, HEADER_SIZE));
            itemCommonSchema.write(writer(output, HEADER_SIZE), itemCommon);

            const subSchema = [
                armorSchema,
                containerSchema,
                drugSchema,
                weaponSchema,
                ammoSchema,
                miscItemSchema,
                keySchema,
            ][itemCommon.subType];
            if (subSchema) {
                const subData = subSchema.read(reader(input, ITEM_SUBTYPE_OFFSET));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic dispatch across heterogeneous schemas
                (subSchema as any).write(writer(output, ITEM_SUBTYPE_OFFSET), subData);
            }
            break;
        }
        case 1: {
            // Critter
            const critter = critterSchema.read(reader(input, HEADER_SIZE));
            critterSchema.write(writer(output, HEADER_SIZE), critter);
            break;
        }
        case 2: {
            // Scenery
            const scenery = sceneryCommonSchema.read(reader(input, HEADER_SIZE));
            sceneryCommonSchema.write(writer(output, HEADER_SIZE), scenery);

            const subSchema = [
                doorSchema,
                stairsSchema,
                elevatorSchema,
                ladderSchema,
                ladderSchema,
                genericScenerySchema,
            ][scenery.subType];
            if (subSchema) {
                const subData = subSchema.read(reader(input, SCENERY_SUBTYPE_OFFSET));
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic dispatch across heterogeneous schemas
                (subSchema as any).write(writer(output, SCENERY_SUBTYPE_OFFSET), subData);
            }
            break;
        }
        case 3: {
            // Wall
            const wall = wallSchema.read(reader(input, HEADER_SIZE));
            wallSchema.write(writer(output, HEADER_SIZE), wall);
            break;
        }
        case 4: {
            // Tile
            const tile = tileSchema.read(reader(input, HEADER_SIZE));
            tileSchema.write(writer(output, HEADER_SIZE), tile);
            break;
        }
        case 5: {
            // Misc
            const misc = miscSchema.read(reader(input, HEADER_SIZE));
            miscSchema.write(writer(output, HEADER_SIZE), misc);
            break;
        }
    }

    return output;
}

/** Load all .pro files in a subdirectory */
function loadProFiles(subDir: string): Array<{ name: string; path: string }> {
    const dir = path.join(FIXTURES, subDir);
    if (!fs.existsSync(dir)) return [];
    return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".pro") && !dir.includes("bad"))
        .map((f) => ({ name: `${subDir}/${f}`, path: path.join(dir, f) }));
}

const GOOD_DIRS = ["misc", "walls", "tiles", "critters", "scenery", "items"];
const fixtures = GOOD_DIRS.flatMap((dir) => loadProFiles(dir));

describe("PRO round-trip via schemas (read -> write -> byte-identical)", () => {
    it.each(fixtures)("$name round-trips to identical bytes", ({ path: proPath }) => {
        const input = new Uint8Array(fs.readFileSync(proPath));
        const output = roundTrip(input);
        expect(Buffer.from(output).equals(Buffer.from(input))).toBe(true);
    });
});

describe("PRO round-trip via serializer (parse -> serialize -> byte-identical)", () => {
    it.each(fixtures)("$name serializes to identical bytes", ({ path: proPath }) => {
        const input = new Uint8Array(fs.readFileSync(proPath));
        const parsed = proParser.parse(input);
        expect(parsed.errors).toBeUndefined();
        const output = proParser.serialize!(parsed);
        expect(Buffer.from(output).equals(Buffer.from(input))).toBe(true);
    });

    it("serializes from the canonical document instead of the display tree when present", () => {
        const proPath = path.join(FIXTURES, "misc", "00000001.pro");
        const input = new Uint8Array(fs.readFileSync(proPath));
        const parsed = proParser.parse(input);
        expect(parsed.errors).toBeUndefined();

        const header = parsed.root.fields[0];
        expect(header && "fields" in header).toBe(true);
        if (!header || !("fields" in header)) {
            throw new Error("Expected header group");
        }

        const textId = header.fields.find((entry) => !("fields" in entry) && entry.name === "Text ID");
        expect(textId && !("fields" in textId)).toBe(true);
        if (!textId || "fields" in textId) {
            throw new Error("Expected Text ID field");
        }

        textId.value = 999_999;
        textId.rawValue = 999_999;

        const output = proParser.serialize!(parsed);
        expect(Buffer.from(output).equals(Buffer.from(input))).toBe(true);
    });

    it("rejects invalid structural PRO trees instead of using a serializer fallback", () => {
        const proPath = path.join(FIXTURES, "misc", "00000001.pro");
        const input = new Uint8Array(fs.readFileSync(proPath));
        const parsed = proParser.parse(input);
        expect(parsed.errors).toBeUndefined();

        const header = parsed.root.fields[0];
        expect(header && "fields" in header).toBe(true);
        if (!header || !("fields" in header)) {
            throw new Error("Expected header group");
        }

        const objectType = header.fields.find((entry) => !("fields" in entry) && entry.name === "Object Type");
        expect(objectType && !("fields" in objectType)).toBe(true);
        if (!objectType || "fields" in objectType) {
            throw new Error("Expected Object Type field");
        }

        objectType.value = "Critter";
        objectType.rawValue = 1;
        parsed.document = undefined;

        expect(() => proParser.serialize!(parsed)).toThrow(/required for critter PRO snapshots/i);
    });

    it("clamps invalid header values while rebuilding canonical data for save and JSON export", () => {
        const proPath = path.join(FIXTURES, "misc", "00000001.pro");
        const input = new Uint8Array(fs.readFileSync(proPath));
        const parsed = proParser.parse(input);
        expect(parsed.errors).toBeUndefined();

        const header = parsed.root.fields[0];
        expect(header && "fields" in header).toBe(true);
        if (!header || !("fields" in header)) {
            throw new Error("Expected header group");
        }

        const lightRadius = header.fields.find((entry) => !("fields" in entry) && entry.name === "Light Radius");
        expect(lightRadius && !("fields" in lightRadius)).toBe(true);
        if (!lightRadius || "fields" in lightRadius) {
            throw new Error("Expected Light Radius field");
        }

        lightRadius.value = 9;
        lightRadius.rawValue = 9;
        parsed.document = undefined;

        expect(() => createBinaryJsonSnapshot(parsed)).not.toThrow();
        const snapshot = JSON.parse(createBinaryJsonSnapshot(parsed)) as {
            document: { header: { lightRadius: number } };
        };
        expect(snapshot.document.header.lightRadius).toBe(8);

        const output = proParser.serialize!(parsed);
        const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
        expect(view.getUint32(0x0c, false)).toBe(8);
    });
});
