import type { TranslatedStruct } from "./translate.ts";

/** Identifiers imported from typed-binary directly. */
const TYPED_BINARY_NAMES = new Set(["i8", "u8", "i16", "u16", "i32", "u32"]);
/** Identifiers imported from binary/src/spec/types. */
const SPEC_TYPES_NAMES = new Set(["arraySpec"]);

export interface EmitInput {
    readonly struct: TranslatedStruct;
    readonly specConst: string;
    readonly dataType: string;
    /** IESDP-relative path used in the auto-generated banner. */
    readonly sourcePath: string;
}

function partitionImports(imports: ReadonlySet<string>): {
    readonly typedBinary: readonly string[];
    readonly specTypes: readonly string[];
} {
    const typedBinary: string[] = [];
    const specTypes: string[] = [];
    for (const name of imports) {
        if (TYPED_BINARY_NAMES.has(name)) {
            typedBinary.push(name);
        } else if (SPEC_TYPES_NAMES.has(name)) {
            specTypes.push(name);
        } else {
            throw new Error(`Unknown import: ${name}`);
        }
    }
    return { typedBinary: typedBinary.sort(), specTypes: specTypes.sort() };
}

export function emitSpecModule(input: EmitInput): string {
    const { typedBinary, specTypes } = partitionImports(input.struct.imports);
    const lines: string[] = [];

    lines.push(`// Auto-generated from IESDP ${input.sourcePath}. Do not hand-edit.`);
    lines.push("");

    if (typedBinary.length > 0) {
        lines.push(`import { ${typedBinary.join(", ")} } from "typed-binary";`);
    }
    const specImports = [...specTypes, "type FieldSpec", "type SpecData"];
    lines.push(`import { ${specImports.join(", ")} } from "../../spec/types";`);
    lines.push("");

    lines.push(`export const ${input.specConst} = {`);
    for (const field of input.struct.fields) {
        lines.push(`    ${field.name}: ${field.fieldSource},`);
    }
    lines.push(`} satisfies Record<string, FieldSpec>;`);
    lines.push("");
    lines.push(`export type ${input.dataType} = SpecData<typeof ${input.specConst}>;`);
    lines.push("");

    return lines.join("\n");
}
