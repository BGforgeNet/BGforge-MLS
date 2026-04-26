import { describe, it, expect } from "vitest";
import { humanize, type FieldPresentation, type StructPresentation } from "../src/spec/presentation";

describe("humanize", () => {
    it.each([
        ["drNormal", "Dr Normal"],
        ["maleFrmId", "Male Frm Id"],
        ["ac", "Ac"],
        ["acID", "Ac ID"],
        ["lightRadius", "Light Radius"],
    ])("%s -> %s", (input, expected) => {
        expect(humanize(input)).toBe(expected);
    });
});

describe("StructPresentation", () => {
    it("accepts partial mappings keyed by field name", () => {
        type Data = { a: number; b: number };
        const pres: StructPresentation<Data> = {
            a: { label: "Alpha", unit: "%" },
        };
        expect(pres.a?.label).toBe("Alpha");
        expect(pres.b).toBeUndefined();
    });

    it("FieldPresentation holds all UI hints", () => {
        const fp: FieldPresentation = {
            label: "X",
            unit: "caps",
            format: "hex32",
            editable: false,
        };
        expect(fp.format).toBe("hex32");
    });
});
