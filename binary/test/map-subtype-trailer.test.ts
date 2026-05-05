/**
 * Per-subtype trailer decoders for MAP item / scenery records.
 *
 * fallout2-ce reads the trailer through `objectDataRead` (proto.cc:554) by
 * loading the referenced .pro and switching on `proto->item.type` /
 * `proto->scenery.type`. This codebase substitutes a precomputed pid→subType
 * resolver, then advances the cursor by per-subtype byte counts:
 *
 *   item:    armor=0, container=0, drug=0, weapon=8, ammo=4, misc=4, key=4
 *   scenery: door=4, stairs=8, elevator=8, ladder=8 (v20) / 4 (v19), generic=0
 */

import { describe, it, expect } from "vitest";
import { decodeItemSubtypeTrailer, decodeScenerySubtypeTrailer } from "../src/map/parse-objects";

const ITEM_ARMOR = 0;
const ITEM_CONTAINER = 1;
const ITEM_DRUG = 2;
const ITEM_WEAPON = 3;
const ITEM_AMMO = 4;
const ITEM_MISC = 5;
const ITEM_KEY = 6;

const SCENERY_DOOR = 0;
const SCENERY_STAIRS = 1;
const SCENERY_ELEVATOR = 2;
const SCENERY_LADDER_UP = 3;
const SCENERY_LADDER_DOWN = 4;
const SCENERY_GENERIC = 5;

const MAP_VERSION_FO1 = 19;
const MAP_VERSION_FO2 = 20;

function buildBE(values: number[]): Uint8Array {
    const buf = new Uint8Array(values.length * 4);
    const view = new DataView(buf.buffer);
    values.forEach((v, i) => view.setInt32(i * 4, v, false));
    return buf;
}

describe("decodeItemSubtypeTrailer", () => {
    it.each([
        ["Armor", ITEM_ARMOR],
        ["Container", ITEM_CONTAINER],
        ["Drug", ITEM_DRUG],
    ])("%s (subType %i) reads 0 bytes", (_label, subType) => {
        const r = decodeItemSubtypeTrailer(new Uint8Array(0), 0, subType);
        expect(r.fields).toEqual([]);
        expect(r.offset).toBe(0);
    });

    it("Weapon (subType 3) reads 8 bytes: ammoQuantity then ammoTypePid", () => {
        const buf = buildBE([42, 0xa3]);
        const r = decodeItemSubtypeTrailer(buf, 0, ITEM_WEAPON);
        expect(r.offset).toBe(8);
        expect(r.fields).toHaveLength(2);
        expect(r.fields[0]?.name).toMatch(/Ammo Quantity/i);
        expect(r.fields[0]?.value).toBe(42);
        expect(r.fields[1]?.name).toMatch(/Ammo Type/i);
        expect(r.fields[1]?.value).toBe(0xa3);
    });

    it("Ammo (subType 4) reads 4 bytes: quantity", () => {
        const buf = buildBE([99]);
        const r = decodeItemSubtypeTrailer(buf, 0, ITEM_AMMO);
        expect(r.offset).toBe(4);
        expect(r.fields).toHaveLength(1);
        expect(r.fields[0]?.name).toMatch(/Quantity/i);
        expect(r.fields[0]?.value).toBe(99);
    });

    it("Misc (subType 5) reads 4 bytes: charges", () => {
        const buf = buildBE([7]);
        const r = decodeItemSubtypeTrailer(buf, 0, ITEM_MISC);
        expect(r.offset).toBe(4);
        expect(r.fields[0]?.name).toMatch(/Charges/i);
        expect(r.fields[0]?.value).toBe(7);
    });

    it("Key (subType 6) reads 4 bytes: keyCode", () => {
        const buf = buildBE([1234]);
        const r = decodeItemSubtypeTrailer(buf, 0, ITEM_KEY);
        expect(r.offset).toBe(4);
        expect(r.fields[0]?.name).toMatch(/Key Code/i);
        expect(r.fields[0]?.value).toBe(1234);
    });

    it("respects start offset (does not assume offset=0)", () => {
        const buf = new Uint8Array(16);
        new DataView(buf.buffer).setInt32(8, 99, false);
        const r = decodeItemSubtypeTrailer(buf, 8, ITEM_AMMO);
        expect(r.offset).toBe(12);
        expect(r.fields[0]?.value).toBe(99);
    });
});

describe("decodeScenerySubtypeTrailer", () => {
    it("Door (subType 0) reads 4 bytes: openFlags", () => {
        const buf = buildBE([0xf]);
        const r = decodeScenerySubtypeTrailer(buf, 0, SCENERY_DOOR, MAP_VERSION_FO2);
        expect(r.offset).toBe(4);
        expect(r.fields[0]?.name).toMatch(/Open Flags/i);
        expect(r.fields[0]?.value).toBe(0xf);
    });

    it("Stairs (subType 1) reads 8 bytes: destinationBuiltTile then destinationMap", () => {
        const buf = buildBE([0x12345, 7]);
        const r = decodeScenerySubtypeTrailer(buf, 0, SCENERY_STAIRS, MAP_VERSION_FO2);
        expect(r.offset).toBe(8);
        expect(r.fields).toHaveLength(2);
        expect(r.fields[0]?.value).toBe(0x12345);
        expect(r.fields[1]?.value).toBe(7);
    });

    it("Elevator (subType 2) reads 8 bytes: type then level", () => {
        const buf = buildBE([2, 1]);
        const r = decodeScenerySubtypeTrailer(buf, 0, SCENERY_ELEVATOR, MAP_VERSION_FO2);
        expect(r.offset).toBe(8);
        expect(r.fields).toHaveLength(2);
        expect(r.fields[0]?.value).toBe(2);
        expect(r.fields[1]?.value).toBe(1);
    });

    it.each([
        ["LadderUp", SCENERY_LADDER_UP],
        ["LadderDown", SCENERY_LADDER_DOWN],
    ])("%s (subType %i) reads 8 bytes on v20: destinationMap then destinationBuiltTile", (_label, subType) => {
        const buf = buildBE([7, 0x12345]);
        const r = decodeScenerySubtypeTrailer(buf, 0, subType, MAP_VERSION_FO2);
        expect(r.offset).toBe(8);
        expect(r.fields).toHaveLength(2);
        expect(r.fields[0]?.value).toBe(7);
        expect(r.fields[1]?.value).toBe(0x12345);
    });

    it.each([
        ["LadderUp", SCENERY_LADDER_UP],
        ["LadderDown", SCENERY_LADDER_DOWN],
    ])("%s (subType %i) reads 4 bytes on v19: destinationBuiltTile only", (_label, subType) => {
        const buf = buildBE([0x12345]);
        const r = decodeScenerySubtypeTrailer(buf, 0, subType, MAP_VERSION_FO1);
        expect(r.offset).toBe(4);
        expect(r.fields).toHaveLength(1);
        expect(r.fields[0]?.value).toBe(0x12345);
    });

    it("Generic (subType 5) reads 0 bytes", () => {
        const r = decodeScenerySubtypeTrailer(new Uint8Array(0), 0, SCENERY_GENERIC, MAP_VERSION_FO2);
        expect(r.fields).toEqual([]);
        expect(r.offset).toBe(0);
    });
});
