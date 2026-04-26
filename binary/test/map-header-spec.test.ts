import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { mapHeaderSpec, type MapHeaderWireData } from "../src/map/specs/header";

const HEADER_SIZE = 0xf0;

describe("mapHeaderSpec", () => {
    it("derives a typed-binary schema that round-trips a known header", () => {
        const schema = toTypedBinarySchema(mapHeaderSpec);

        const filename = [0x6d, 0x61, 0x70, 0x2e, 0x6d, 0x61, 0x70, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // "map.map\0..."
        const field_3C = Array.from({ length: 44 }, (_, i) => i + 1);
        const data: MapHeaderWireData = {
            version: 20,
            filename,
            defaultPosition: 12_345,
            defaultElevation: 0,
            defaultOrientation: 1,
            numLocalVars: 7,
            scriptId: 0x12_34_56_78,
            flags: 0x0a,
            darkness: 1,
            numGlobalVars: 3,
            mapId: 42,
            timestamp: 0xdead_beef,
            field_3C,
        };

        const buf = new ArrayBuffer(HEADER_SIZE);
        schema.write(new BufferWriter(buf, { endianness: "big" }), data);

        const decoded = schema.read(new BufferReader(buf, { endianness: "big" }));
        expect(decoded).toEqual(data);
    });

    it("encodes filename bytes at offset 4 in wire-readable form", () => {
        const schema = toTypedBinarySchema(mapHeaderSpec);
        const filename = [0x66, 0x6f, 0x6f, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // "foo\0"

        const buf = new ArrayBuffer(HEADER_SIZE);
        schema.write(new BufferWriter(buf, { endianness: "big" }), {
            version: 0,
            filename,
            defaultPosition: 0,
            defaultElevation: 0,
            defaultOrientation: 0,
            numLocalVars: 0,
            scriptId: 0,
            flags: 0,
            darkness: 0,
            numGlobalVars: 0,
            mapId: 0,
            timestamp: 0,
            field_3C: Array.from({ length: 44 }, () => 0),
        });

        const view = new Uint8Array(buf);
        expect(Array.from(view.slice(4, 4 + 16))).toEqual(filename);
    });
});
