import { describe, it, expect } from "vitest";
import { u32 } from "typed-binary";
import { toDomainRanges } from "../src/spec/derive-domain-ranges";
import { type StructSpec } from "../src/spec/types";

describe("toDomainRanges", () => {
    it("returns entries only for fields with declared domain", () => {
        type T = { a: number; b: number; c: number };
        const spec: StructSpec<T> = {
            a: { codec: u32 },
            b: { codec: u32, domain: { min: 0, max: 8 } },
            c: { codec: u32, domain: { min: 1, max: 100 } },
        };

        const result = toDomainRanges(spec, "pro.header");
        expect(result).toEqual({
            "pro.header.b": { min: 0, max: 8 },
            "pro.header.c": { min: 1, max: 100 },
        });
    });

    it("returns empty object when no field has a domain", () => {
        type T = { a: number };
        const spec: StructSpec<T> = { a: { codec: u32 } };
        expect(toDomainRanges(spec, "pro.header")).toEqual({});
    });

    it("uses the prefix verbatim", () => {
        type T = { x: number };
        const spec: StructSpec<T> = { x: { codec: u32, domain: { min: 0, max: 1 } } };
        expect(toDomainRanges(spec, "map.objects.elevations[].objects[].exitGrid")).toEqual({
            "map.objects.elevations[].objects[].exitGrid.x": { min: 0, max: 1 },
        });
    });
});
