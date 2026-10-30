import { describe, it, expect } from "vitest";
import { cpuTimeMs } from "@bgforge/shared/cpu-time";
import { humanize, type FieldPresentation, type StructPresentation } from "../src/spec/presentation";

describe("humanize", () => {
    it.each([
        ["drNormal", "Dr Normal"],
        ["maleFrmId", "Male Frm Id"],
        ["ac", "Ac"],
        ["acID", "Ac ID"],
        ["lightRadius", "Light Radius"],
        ["XMLHttpRequest", "XML Http Request"],
        ["ABCdEFg", "AB Cd E Fg"],
        ["IDs", "I Ds"],
        ["ABC", "ABC"],
        ["ABcd", "A Bcd"],
        ["aBCd", "A B Cd"],
        ["HTMLParser2", "HTML Parser2"],
        ["A1Bc", "A1Bc"],
        ["", ""],
    ])("%j -> %j", (input, expected) => {
        expect(humanize(input)).toBe(expected);
    });

    it("humanizes a long uppercase run followed by a rejecting tail in linear time", () => {
        const input = `${"A".repeat(100_000)}1`;
        let label = "";
        const elapsed = cpuTimeMs(() => {
            label = humanize(input);
        });
        expect(elapsed).toBeLessThan(500);
        expect(label).toBe(input);
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
