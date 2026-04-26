import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { objectBaseSpec, inventoryHeaderSpec, critterDataSpec, exitGridSpec } from "../src/map/specs/object";
import { MAP_OBJECT_BASE_SIZE, MAP_OBJECT_DATA_HEADER_SIZE } from "../src/map/parse-helpers";

const objectBaseCodec = toTypedBinarySchema(objectBaseSpec);
const inventoryHeaderCodec = toTypedBinarySchema(inventoryHeaderSpec);
const critterDataCodec = toTypedBinarySchema(critterDataSpec);
const exitGridCodec = toTypedBinarySchema(exitGridSpec);

describe("object spec modules", () => {
    it("objectBaseSpec maps 1:1 onto MAP_OBJECT_BASE_SIZE (0x48)", () => {
        const sample = {
            id: 1,
            tile: 100,
            x: 10,
            y: 20,
            screenX: 30,
            screenY: 40,
            frame: 0,
            rotation: 2,
            fid: 0xab_cd_ef_01,
            flags: 0,
            elevation: 1,
            pid: 0x0100_0042, // type 1, id 0x42
            cid: -1,
            lightDistance: 0,
            lightIntensity: 0,
            field74: 0,
            sid: -1,
            scriptIndex: -1,
        };
        const buf = new ArrayBuffer(MAP_OBJECT_BASE_SIZE);
        objectBaseCodec.write(new BufferWriter(buf, { endianness: "big" }), sample);
        expect(MAP_OBJECT_BASE_SIZE).toBe(72);

        const r = new BufferReader(buf, { endianness: "big" });
        expect(objectBaseCodec.read(r)).toEqual(sample);
    });

    it("inventoryHeaderSpec maps 1:1 onto MAP_OBJECT_DATA_HEADER_SIZE (0x0c)", () => {
        const sample = { inventoryLength: 3, inventoryCapacity: 8, inventoryPointer: 0 };
        const buf = new ArrayBuffer(MAP_OBJECT_DATA_HEADER_SIZE);
        inventoryHeaderCodec.write(new BufferWriter(buf, { endianness: "big" }), sample);
        expect(MAP_OBJECT_DATA_HEADER_SIZE).toBe(12);

        const r = new BufferReader(buf, { endianness: "big" });
        expect(inventoryHeaderCodec.read(r)).toEqual(sample);
    });

    it("critterDataSpec round-trips an 11×i32 (44-byte) block", () => {
        const sample = {
            reaction: 0,
            damageLastTurn: 0,
            combatManeuver: 0,
            currentAp: 6,
            combatResults: 0,
            aiPacket: 0,
            team: 1,
            whoHitMeCid: -1,
            currentHp: 50,
            radiation: 0,
            poison: 0,
        };
        const buf = new ArrayBuffer(44);
        critterDataCodec.write(new BufferWriter(buf, { endianness: "big" }), sample);
        const r = new BufferReader(buf, { endianness: "big" });
        expect(critterDataCodec.read(r)).toEqual(sample);
    });

    it("exitGridSpec round-trips a 4×i32 (16-byte) block", () => {
        const sample = {
            destinationMap: 1,
            destinationTile: 100,
            destinationElevation: 0,
            destinationRotation: 0,
        };
        const buf = new ArrayBuffer(16);
        exitGridCodec.write(new BufferWriter(buf, { endianness: "big" }), sample);
        const r = new BufferReader(buf, { endianness: "big" });
        expect(exitGridCodec.read(r)).toEqual(sample);
    });
});
