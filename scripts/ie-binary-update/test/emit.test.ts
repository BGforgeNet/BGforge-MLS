import { describe, expect, test } from "vitest";
import { emitSpecModule } from "../src/emit.ts";
import type { TranslatedStruct } from "../src/translate.ts";

const sampleStruct: TranslatedStruct = {
    fields: [
        {
            name: "signature",
            fieldSource: "arraySpec({ element: { codec: u8 }, count: 4 })",
            imports: ["u8", "arraySpec"],
        },
        { name: "flags", fieldSource: "{ codec: u32 }", imports: ["u32"] },
    ],
    imports: new Set(["u8", "u32", "arraySpec"]),
};

describe("emitSpecModule", () => {
    test("emits typed-binary import sorted alphabetically", () => {
        const output = emitSpecModule({
            struct: sampleStruct,
            specConst: "itmHeaderSpec",
            dataType: "ItmHeaderData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).toContain('import { u32, u8 } from "typed-binary";');
    });

    test("emits arraySpec + FieldSpec/SpecData type imports from spec types", () => {
        const output = emitSpecModule({
            struct: sampleStruct,
            specConst: "itmHeaderSpec",
            dataType: "ItmHeaderData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).toContain('import { arraySpec, type FieldSpec, type SpecData } from "../../spec/types";');
    });

    test("emits banner attributing IESDP source", () => {
        const output = emitSpecModule({
            struct: sampleStruct,
            specConst: "itmHeaderSpec",
            dataType: "ItmHeaderData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).toContain(
            "// Auto-generated from IESDP _data/file_formats/itm_v1/header.yml. Do not hand-edit.",
        );
    });

    test("emits the spec const with each field on its own line and satisfies clause", () => {
        const output = emitSpecModule({
            struct: sampleStruct,
            specConst: "itmHeaderSpec",
            dataType: "ItmHeaderData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).toContain("export const itmHeaderSpec = {");
        expect(output).toContain("signature: arraySpec({ element: { codec: u8 }, count: 4 }),");
        expect(output).toContain("flags: { codec: u32 },");
        expect(output).toContain("} satisfies Record<string, FieldSpec>;");
    });

    test("emits the SpecData type alias", () => {
        const output = emitSpecModule({
            struct: sampleStruct,
            specConst: "itmHeaderSpec",
            dataType: "ItmHeaderData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).toContain("export type ItmHeaderData = SpecData<typeof itmHeaderSpec>;");
    });

    test("omits the typed-binary import line entirely when no codec types are referenced", () => {
        const output = emitSpecModule({
            struct: { fields: [], imports: new Set() },
            specConst: "emptySpec",
            dataType: "EmptyData",
            sourcePath: "_data/file_formats/itm_v1/header.yml",
        });
        expect(output).not.toContain("typed-binary");
    });
});
