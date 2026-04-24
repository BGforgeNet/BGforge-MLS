import { describe, expect, it } from "vitest";
import {
    getFormatPresentationSchema,
    resolveFieldPresentation,
    toNumericOptionMap,
} from "../src/parsers/presentation-schema";

describe("presentation-schema", () => {
    it("exposes per-format presentation metadata for external consumers", () => {
        expect(getFormatPresentationSchema("pro")).toMatchObject({
            schemaVersion: 1,
            format: "pro",
        });
        expect(getFormatPresentationSchema("map")).toMatchObject({
            schemaVersion: 1,
            format: "map",
        });
        expect(getFormatPresentationSchema("frm")).toBeUndefined();
    });

    it("resolves exact field metadata", () => {
        expect(resolveFieldPresentation("pro", "pro.header.objectType", "Object Type")).toEqual({
            label: "Object Type",
            presentationType: "enum",
            enumOptions: expect.objectContaining({
                "0": "Item",
                "2": "Scenery",
            }),
        });
    });

    it("merges pattern metadata for dynamic MAP fields", () => {
        expect(resolveFieldPresentation("map", "map.objects.elevations[].objects[].base.pid", "PID")).toEqual({
            numericFormat: "hex32",
        });

        expect(resolveFieldPresentation("map", "map.scripts[].extents[].slots[].flags", "Entry 0 Flags")).toEqual({
            presentationType: "flags",
            flagOptions: expect.objectContaining({
                "1": "Loaded",
                "16": "NoRemove",
            }),
        });
    });

    it("converts string-keyed options to numeric lookup tables", () => {
        expect(toNumericOptionMap({ "1": "One", "16": "Sixteen" })).toEqual({
            1: "One",
            16: "Sixteen",
        });
        expect(toNumericOptionMap()).toBeUndefined();
    });
});
