import path from "node:path";
import { describe, expect, test } from "vitest";
import {
    extractOpcodeRelationships,
    emitOpcodeRelationshipsModule,
    buildMergedRelationships,
} from "../src/extract-opcodes.ts";
import { OpcodeRelationshipOverrides } from "../src/opcode-relationships.overrides.ts";

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

describe("buildMergedRelationships", () => {
    test("curated override enum is present for op0 param2 (AC type)", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // Verified from op000.html: 0->All, 1->Crushing, 2->Missile, 4->Piercing, 8->Slashing, 16->Base AC Setting
        expect(merged.get(0)?.param2?.enum?.[0]).toBe("All");
        expect(merged.get(0)?.param2?.enum?.[1]).toBe("Crushing");
        expect(merged.get(0)?.param2?.enum?.[8]).toBe("Slashing");
        expect(merged.get(0)?.param2?.enum?.[16]).toBe("Base AC Setting");
    });

    test("curated override enum is present for op1 param2 (modifier type)", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // Verified from op001.html: 0->Cumulative Modifier, 1->Flat Value Modifier, 2->Percentage Modifier
        expect(merged.get(1)?.param2?.enum?.[0]).toBe("Cumulative Modifier");
        expect(merged.get(1)?.param2?.enum?.[1]).toBe("Flat Value Modifier");
        expect(merged.get(1)?.param2?.enum?.[2]).toBe("Percentage Modifier");
    });

    test("harvested label is preserved when override only supplies enum", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // op1 param2 label comes from frontmatter; override only adds enum
        expect(merged.get(1)?.param2?.label).toBe("Type");
        // op0 param2 label also from frontmatter
        expect(merged.get(0)?.param2?.label).toBe("Type");
    });

    test("an opcode with no table and no override has labels but no enum (op2)", () => {
        // op002.html has params labeled "Irrelevant" and no enum table; not in OpcodeRelationshipOverrides
        expect(OpcodeRelationshipOverrides[2]).toBeUndefined();
        const merged = buildMergedRelationships(OPCODES_DIR);
        const op2 = merged.get(2);
        expect(op2?.param1?.label).toBe("Irrelevant");
        expect(op2?.param1?.enum).toBeUndefined();
        expect(op2?.param2?.enum).toBeUndefined();
    });

    test("the harvest never throws across the full opcode corpus and returns a non-empty map", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // The corpus has entries for at least opcode 0 and 1.
        expect(merged.size).toBeGreaterThan(1);
        expect(merged.has(0)).toBe(true);
        expect(merged.has(1)).toBe(true);
    });

    test("emitted module includes enum entries for op0", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        const src = emitOpcodeRelationshipsModule(merged, "_opcodes/opNNN.html");
        // The emitted source should contain enum entries for op0's AC type values
        expect(src).toContain('"All"');
        expect(src).toContain('"Crushing"');
        expect(src).toContain('"Base AC Setting"');
    });

    test("emitted module includes curated override for op39 param2 (Wake on Damage)", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // Verified from op039.html: 0->Yes, 1->No
        expect(merged.get(39)?.param2?.enum?.[0]).toBe("Yes");
        expect(merged.get(39)?.param2?.enum?.[1]).toBe("No");
    });
});
