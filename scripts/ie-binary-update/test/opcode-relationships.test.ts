import path from "node:path";
import { describe, expect, test } from "vitest";
import {
    extractOpcodes,
    extractOpcodeRelationships,
    emitOpcodeRelationshipsModule,
    buildMergedRelationships,
} from "../src/extract-opcodes.ts";
import { OpcodeRelationshipOverrides } from "../src/opcode-relationships.overrides.ts";
import { OPCODE_RESOURCE_UNRESOLVED } from "../src/opcode-resources.overrides.ts";

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

    test("curated resource target types reach the merged table", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // Verified from each opcode's own page: 146 casts a spell, 111 creates an item, 214 reads a 2da.
        expect(merged.get(146)?.resourceType).toBe("SPL");
        expect(merged.get(111)?.resourceType).toBe("ITM");
        expect(merged.get(214)?.resourceType).toBe("2DA");
        // 215's page names two ("the BAM/VVC"), so it is deliberately absent rather than resolved to one.
        expect(merged.get(215)?.resourceType).toBeUndefined();
    });

    // An exclusion list nobody checks drifts into a place where a resolvable opcode hides. Each entry has to
    // still be absent from the table - if one gained a type, its reason for being listed has expired.
    test("keeps no stale entry in the unresolved-resource list", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        const resolved = OPCODE_RESOURCE_UNRESOLVED.filter((n) => merged.get(n)?.resourceType !== undefined);
        expect(resolved).toEqual([]);
    });

    test("the IDS-file map covers the opcodes documented only on an engine-variant page", () => {
        const merged = buildMergedRelationships(OPCODES_DIR);
        // op177 has no canonical page at all, so a canonical-only harvest could never have carried this.
        expect(merged.get(177)?.idsFileByParam2?.[4]).toEqual(["RACE"]);
        expect(merged.get(344)?.idsFileByParam2?.[9]).toEqual(["KIT"]);
    });
});

/**
 * IESDP documents 137 of its 442 opcodes ONLY on engine-variant pages - the whole EE (318-383) and IWD2
 * (400-457) ranges, plus 13 others including 177 "Use EFF File". Reading canonical pages only dropped every
 * one of them from both tables, so they rendered as a bare number. These pin the fallback and its two bounds:
 * a variant never overrides a canonical page, and never donates fields when it describes a different opcode.
 */
describe("engine-variant fallback", () => {
    test("an opcode with no canonical page still gets a name and parameter labels", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op177 exists only as op177-bg2/-bgee/-iwd2/-pst/-bg1-derived.
        expect(opcodes.get(177)).toBe("Use EFF File");
        expect(rels.get(177)?.param1?.label).toBe("IDS Entry");
        expect(rels.get(177)?.param2?.label).toBe("IDS File");
    });

    test("covers the EE and IWD2 ranges, which have no canonical pages at all", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        expect(opcodes.get(328)).toBe("State: Set Extended or Spell State");
        expect(opcodes.get(457)).toBe("Spell Effect: Rapid Shot");
    });

    test("a variant does not override a label the canonical page defines", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op025.html says "Damage Amount"; op025-bgee.html says "Amount_1". The canonical page wins.
        expect(rels.get(25)?.param1?.label).toBe("Damage Amount");
    });

    test("a variant fills an EE-era slot the canonical page leaves undefined", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op025.html has no param3/param4 keys; op025-bgee.html does, and both pages name the same opcode.
        expect(rels.get(25)?.param3?.label).toBe("Amount_2");
        expect(rels.get(25)?.param4?.label).toBe("Frequency Multiplier");
    });

    test("a variant describing a DIFFERENT opcode donates nothing", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op109.html is "State: Hold"; op109-bgee.html is "State: Paralyze" and carries special: "Mode".
        // Different opname, so the slot is not borrowed - the numbers were reused between editions.
        expect(rels.get(109)?.special).toBeUndefined();
    });

    test("availability comes from the canonical page, or the union of variants when there is none", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op001.html carries the whole matrix itself, including the false entries.
        expect(rels.get(1)?.availability).toMatchObject({ bg1: true, bgee: false, pstee: false });
        // Each op177 variant declares only its own engine, so only their union says where it exists.
        expect(rels.get(177)?.availability).toMatchObject({ bg1: true, bg2: true, bgee: true, iwd2: true });
    });

    test("frontmatter labels are decoded, not passed through as HTML entities", () => {
        const rels = extractOpcodeRelationships(OPCODES_DIR);
        // op012-bgee.html writes `param2: "Mode &amp; Damage Type"`.
        expect(rels.get(12)?.special?.label).toBe("Flags");
        expect(Object.values(rels.get(12) ?? {}).some((v) => JSON.stringify(v).includes("&amp;"))).toBe(false);
    });
});
