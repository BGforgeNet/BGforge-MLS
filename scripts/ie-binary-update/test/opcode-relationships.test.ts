import path from "node:path";
import { describe, expect, test } from "vitest";
import { extractOpcodeRelationships, emitOpcodeRelationshipsModule } from "../src/extract-opcodes.ts";

const IESDP_DIR = path.join(__dirname, "..", "..", "..", "external/infinity-engine/iesdp");
const OPCODES_DIR = path.join(IESDP_DIR, "_opcodes");

describe("extractOpcodeRelationships", () => {
    test("harvests param labels and engine availability for op1", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        const op1 = rels.get(1);
        expect(op1?.param1?.label).toBe("Key Modifier");
        expect(op1?.param2?.label).toBe("Type");
        expect(op1?.availability).toMatchObject({ bg1: true, bgee: false, pst: true, pstee: false });
    });

    test("emitted module has the do-not-hand-edit banner and a typed export", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        const src = emitOpcodeRelationshipsModule(rels, "_opcodes/opNNN.html");
        expect(src).toContain("// Auto-generated from IESDP _opcodes/opNNN.html. Do not hand-edit.");
        expect(src).toContain("export const OpcodeRelationships: Readonly<Record<number, OpcodeRelationship>>");
    });
});
