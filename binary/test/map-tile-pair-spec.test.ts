import { describe, it, expect } from "vitest";
import { BufferReader, BufferWriter } from "typed-binary";
import { toTypedBinarySchema } from "../src/spec/derive-typed-binary";
import { tilePairSpec } from "../src/map/specs/tile-pair";

describe("tilePairSpec", () => {
    it("derives a codec that round-trips a known tile-pair word", () => {
        const codec = toTypedBinarySchema(tilePairSpec);
        const data = { floorTileId: 0x123, floorFlags: 0x4, roofTileId: 0x567, roofFlags: 0x8 };

        const buf = new ArrayBuffer(4);
        codec.write(new BufferWriter(buf, { endianness: "big" }), data);
        expect(codec.read(new BufferReader(buf, { endianness: "big" }))).toEqual(data);
    });

    it("matches the legacy hand-coded bit-extraction layout", () => {
        const codec = toTypedBinarySchema(tilePairSpec);

        // packed = roofFlags << 28 | roofTileId << 16 | floorFlags << 12 | floorTileId
        const packed = ((0xa << 28) | (0x123 << 16) | (0x5 << 12) | 0x456) >>> 0;
        const buf = new ArrayBuffer(4);
        new BufferWriter(buf, { endianness: "big" }).writeUint32(packed);

        expect(codec.read(new BufferReader(buf, { endianness: "big" }))).toEqual({
            floorTileId: 0x456,
            floorFlags: 0x5,
            roofTileId: 0x123,
            roofFlags: 0xa,
        });
    });
});
