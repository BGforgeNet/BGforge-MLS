import { describe, expect, it } from "vitest";
import type { Row } from "@bgforge/binary-editor";
import {
    enumOptionList,
    decomposeFlags,
    composeFlags,
    controlKind,
} from "../../../src/binary-editor/webview/state/controls";

const enumRow: Row = {
    id: "0",
    namePath: ["Race"],
    depth: 1,
    kind: "field",
    name: "Race",
    valueType: "enum",
    rawValue: 1,
    displayValue: "Mutant",
    editable: true,
    enumOptions: { "0": "Human", "1": "Mutant" },
};
const flagRow: Row = {
    id: "1",
    namePath: ["Flags"],
    depth: 1,
    kind: "field",
    name: "Flags",
    valueType: "flags",
    rawValue: 5,
    displayValue: "5",
    editable: true,
    flagOptions: { "0": "Visible", "2": "Dead" },
};

describe("controls", () => {
    it("classifies control kind by valueType", () => {
        expect(controlKind(enumRow)).toBe("enum");
        expect(controlKind(flagRow)).toBe("flags");
        expect(controlKind({ ...enumRow, valueType: "uint16", enumOptions: undefined })).toBe("number");
        expect(controlKind({ ...enumRow, valueType: "string", enumOptions: undefined })).toBe("string");
    });

    it("builds an enum option list, injecting Unknown(N) for an out-of-range value", () => {
        expect(enumOptionList(enumRow)).toEqual([
            { value: 0, label: "Human" },
            { value: 1, label: "Mutant" },
        ]);
        const oor = enumOptionList({ ...enumRow, rawValue: 9 });
        expect(oor).toContainEqual({ value: 9, label: "Unknown (9)" });
    });

    it("decomposes and recomposes flag bits", () => {
        // rawValue 5 = bits 0 and 2 set
        expect(decomposeFlags(flagRow)).toEqual([
            { bit: 0, label: "Visible", set: true },
            { bit: 2, label: "Dead", set: true },
        ]);
        expect(composeFlags(5, 0, false)).toBe(4); // clear bit 0
        expect(composeFlags(4, 0, true)).toBe(5); // set bit 0
    });
});
