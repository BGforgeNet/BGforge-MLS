import { describe, it, expect } from "vitest";
import { u32, i32 } from "typed-binary";
import { walkStruct } from "../src/spec/walk-display";
import { type StructSpec } from "../src/spec/types";
import { type StructPresentation } from "../src/spec/presentation";
import type { ParsedGroup } from "../src/types";

describe("walkStruct", () => {
    it("emits a flat group with cumulative offsets and codec-derived types", () => {
        type Data = { a: number; b: number; c: number };
        const spec: StructSpec<Data> = {
            a: { codec: u32 },
            b: { codec: i32 },
            c: { codec: u32 },
        };
        const data: Data = { a: 1, b: -2, c: 3 };
        const result = walkStruct(spec, {}, 0x10, data, "Test");

        expect(result.name).toBe("Test");
        expect(result.fields).toEqual([
            { name: "A", value: 1, offset: 0x10, size: 4, type: "uint32", rawValue: 1 },
            { name: "B", value: -2, offset: 0x14, size: 4, type: "int32", rawValue: -2 },
            { name: "C", value: 3, offset: 0x18, size: 4, type: "uint32", rawValue: 3 },
        ]);
    });

    it("uses presentation label override over humanized field name", () => {
        type Data = { drNormal: number };
        const spec: StructSpec<Data> = { drNormal: { codec: u32 } };
        const pres: StructPresentation<Data> = { drNormal: { label: "Normal" } };

        const result = walkStruct(spec, pres, 0, { drNormal: 30 }, "Damage");
        expect((result.fields[0] as { name: string }).name).toBe("Normal");
    });

    it("appends % unit to numeric value", () => {
        type Data = { x: number };
        const spec: StructSpec<Data> = { x: { codec: u32 } };
        const pres: StructPresentation<Data> = { x: { label: "X", unit: "%" } };

        const result = walkStruct(spec, pres, 0, { x: 30 }, "G");
        expect((result.fields[0] as { value: unknown }).value).toBe("30%");
    });

    it("formats numeric value as hex32 when requested", () => {
        type Data = { flags: number };
        const spec: StructSpec<Data> = { flags: { codec: u32 } };
        const pres: StructPresentation<Data> = { flags: { format: "hex32" } };

        const result = walkStruct(spec, pres, 0, { flags: 0xdeadbeef }, "G");
        expect((result.fields[0] as { value: unknown }).value).toBe("0xdeadbeef");
    });

    it("groups fields per subGroups option, preserving non-grouped fields in declaration order", () => {
        type Data = { ac: number; drN: number; drL: number; perk: number };
        const spec: StructSpec<Data> = {
            ac: { codec: u32 },
            drN: { codec: u32 },
            drL: { codec: u32 },
            perk: { codec: u32 },
        };
        const result = walkStruct(spec, {}, 0, { ac: 1, drN: 2, drL: 3, perk: 4 }, "Armor", {
            subGroups: [{ name: "DR", fields: ["drN", "drL"] }],
        });

        expect(result.fields).toHaveLength(3);
        expect((result.fields[0] as { name: string }).name).toBe("Ac");
        const dr = result.fields[1] as ParsedGroup;
        expect(dr.name).toBe("DR");
        expect(dr.fields).toHaveLength(2);
        expect((result.fields[2] as { name: string }).name).toBe("Perk");
    });

    it("emits enum fields with resolved label and rawValue", () => {
        type Data = { kind: number };
        const spec: StructSpec<Data> = {
            kind: { codec: u32, enum: { 0: "Item", 1: "Critter" } },
        };

        const result = walkStruct(spec, {}, 0, { kind: 1 }, "G");
        expect(result.fields[0]).toMatchObject({
            name: "Kind",
            value: "Critter",
            type: "enum",
            rawValue: 1,
        });
    });

    it("emits 'Unknown (N)' for enum values not in the lookup table", () => {
        type Data = { kind: number };
        const spec: StructSpec<Data> = { kind: { codec: u32, enum: { 0: "A" } } };
        const result = walkStruct(spec, {}, 0, { kind: 99 }, "G");
        expect((result.fields[0] as { value: unknown }).value).toBe("Unknown (99)");
    });

    it("emits flags fields with comma-separated names", () => {
        type Data = { f: number };
        const spec: StructSpec<Data> = {
            f: { codec: u32, flags: { 1: "A", 2: "B", 4: "C" } },
        };

        const result = walkStruct(spec, {}, 0, { f: 0b101 }, "G");
        expect(result.fields[0]).toMatchObject({
            name: "F",
            value: "A, C",
            type: "flags",
            rawValue: 0b101,
        });
    });

    it("emits '(none)' when no flags are active", () => {
        type Data = { f: number };
        const spec: StructSpec<Data> = { f: { codec: u32, flags: { 1: "A" } } };
        const result = walkStruct(spec, {}, 0, { f: 0 }, "G");
        expect((result.fields[0] as { value: unknown }).value).toBe("(none)");
    });

    it("lengthFrom array sizes itself from data[fromField] and advances cursor by element_count * element_bytes", () => {
        type Data = { count: number; values: number[]; trailer: number };
        const spec: StructSpec<Data> = {
            count: { codec: u32 },
            values: { kind: "array", element: { codec: u32 }, count: { fromField: "count" } },
            trailer: { codec: u32 },
        };
        const data: Data = { count: 3, values: [10, 20, 30], trailer: 0xff };
        const result = walkStruct(spec, {}, 0, data, "Variable");

        // count @ 0..4, values @ 4..16 (3*4 bytes), trailer @ 16..20.
        expect(result.fields).toHaveLength(3);
        expect(result.fields[0]).toMatchObject({ name: "Count", offset: 0, size: 4 });
        expect(result.fields[1]).toMatchObject({ name: "Values", offset: 4, size: 12 });
        expect(result.fields[2]).toMatchObject({ name: "Trailer", offset: 16, size: 4 });
    });

    it("packed-field parts share the slot's offset and size; cursor advances once per group", () => {
        type Data = { destTile: number; destElevation: number; destMap: number };
        const spec: StructSpec<Data> = {
            destTile: { codec: u32, packedAs: "destTileAndElevation", bitRange: [0, 26] },
            destElevation: { codec: u32, packedAs: "destTileAndElevation", bitRange: [26, 6] },
            destMap: { codec: u32 },
        };
        const data: Data = { destTile: 5, destElevation: 2, destMap: 0x1234 };
        const result = walkStruct(spec, {}, 0x29, data, "Stairs");

        // Both parts highlight the same wire slot bytes [0x29..0x2D); destMap follows at 0x2D.
        expect(result.fields).toEqual([
            { name: "Dest Tile", value: 5, offset: 0x29, size: 4, type: "uint32", rawValue: 5 },
            { name: "Dest Elevation", value: 2, offset: 0x29, size: 4, type: "uint32", rawValue: 2 },
            { name: "Dest Map", value: 0x1234, offset: 0x2d, size: 4, type: "uint32", rawValue: 0x1234 },
        ]);
    });
});
