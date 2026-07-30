import path from "node:path";
import { describe, expect, test } from "vitest";
import {
    extractOpcodes,
    extractOpcodeReadings,
    emitOpcodeRelationshipsModule,
    buildMergedReadings,
} from "../src/extract-opcodes.ts";
import { OpcodeRelationshipOverrides } from "../src/opcode-relationships.overrides.ts";
import { OPCODE_RESOURCE_UNRESOLVED, OpcodeResourceOverrides } from "../src/opcode-resources.overrides.ts";

const IESDP_DIR = path.join(__dirname, "..", "..", "..", "external/infinity-engine/iesdp");
const OPCODES_DIR = path.join(IESDP_DIR, "_opcodes");

describe("extractOpcodeReadings", () => {
    test("harvests param labels and engine availability for op1", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        const op1 = rels.get(1)?.[0];
        expect(op1?.param1?.label).toBe("Key Modifier");
        expect(op1?.param2?.label).toBe("Type");
        // Every engine, from the union across op001.html and op001-bgee.html. A single page's `bgee: 0` scopes
        // that page's reading; it does not mean the opcode is absent there, which its own EE page shows.
        expect(op1?.availability).toMatchObject({ bg1: true, bgee: true, pst: true, pstee: true });
    });

    test("emitted module has the do-not-hand-edit banner and a typed export", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        const src = emitOpcodeRelationshipsModule(rels, "_opcodes/opNNN.html");
        expect(src).toContain("// Auto-generated from IESDP _opcodes/opNNN.html. Do not hand-edit.");
        expect(src).toContain("export const OpcodeReadings: Readonly<Record<number, readonly OpcodeRelationship[]>>");
    });
});

describe("buildMergedReadings", () => {
    test("curated override enum is present for op0 param2 (AC type)", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // Verified from op000.html: 0->All, 1->Crushing, 2->Missile, 4->Piercing, 8->Slashing, 16->Base AC Setting
        expect(merged.get(0)?.[0]?.param2?.enum?.[0]).toBe("All");
        expect(merged.get(0)?.[0]?.param2?.enum?.[1]).toBe("Crushing");
        expect(merged.get(0)?.[0]?.param2?.enum?.[8]).toBe("Slashing");
        expect(merged.get(0)?.[0]?.param2?.enum?.[16]).toBe("Base AC Setting");
    });

    test("curated override enum is present for op1 param2 (modifier type)", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // Verified from op001.html: 0->Cumulative Modifier, 1->Flat Value Modifier, 2->Percentage Modifier
        expect(merged.get(1)?.[0]?.param2?.enum?.[0]).toBe("Cumulative Modifier");
        expect(merged.get(1)?.[0]?.param2?.enum?.[1]).toBe("Flat Value Modifier");
        expect(merged.get(1)?.[0]?.param2?.enum?.[2]).toBe("Percentage Modifier");
    });

    test("harvested label is preserved when override only supplies enum", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // op1 param2 label comes from frontmatter; override only adds enum
        expect(merged.get(1)?.[0]?.param2?.label).toBe("Type");
        // op0 param2 label also from frontmatter
        expect(merged.get(0)?.[0]?.param2?.label).toBe("Type");
    });

    test("an opcode with no table and no override has labels but no enum (op2)", () => {
        // op002.html has params labeled "Irrelevant" and no enum table; not in OpcodeRelationshipOverrides
        expect(OpcodeRelationshipOverrides[2]).toBeUndefined();
        const merged = buildMergedReadings(OPCODES_DIR);
        const op2 = merged.get(2)?.[0];
        expect(op2?.param1?.label).toBe("Irrelevant");
        expect(op2?.param1?.enum).toBeUndefined();
        expect(op2?.param2?.enum).toBeUndefined();
    });

    test("the harvest never throws across the full opcode corpus and returns a non-empty map", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // The corpus has entries for at least opcode 0 and 1.
        expect(merged.size).toBeGreaterThan(1);
        expect(merged.has(0)).toBe(true);
        expect(merged.has(1)).toBe(true);
    });

    test("emitted module includes enum entries for op0", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        const src = emitOpcodeRelationshipsModule(merged, "_opcodes/opNNN.html");
        // The emitted source should contain enum entries for op0's AC type values
        expect(src).toContain('"All"');
        expect(src).toContain('"Crushing"');
        expect(src).toContain('"Base AC Setting"');
    });

    test("emitted module includes curated override for op39 param2 (Wake on Damage)", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // Verified from op039.html: 0->Yes, 1->No
        expect(merged.get(39)?.[0]?.param2?.enum?.[0]).toBe("Yes");
        expect(merged.get(39)?.[0]?.param2?.enum?.[1]).toBe("No");
    });

    test("curated resource target types reach the merged table", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // Verified from each opcode's own page: 146 casts a spell, 111 creates an item, 214 reads a 2da.
        expect(merged.get(146)?.[0]?.resourceType).toBe("SPL");
        expect(merged.get(111)?.[0]?.resourceType).toBe("ITM");
        expect(merged.get(214)?.[0]?.resourceType).toBe("2DA");
        // 215's page names two ("the BAM/VVC"), so it is deliberately absent rather than resolved to one.
        expect(merged.get(215)?.[0]?.resourceType).toBeUndefined();
    });

    // An exclusion list nobody checks drifts into a place where a resolvable opcode hides. Each entry has to
    // still be absent from the table - if one gained a type, its reason for being listed has expired.
    test("keeps no stale entry in the unresolved-resource list", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        const resolved = OPCODE_RESOURCE_UNRESOLVED.filter((n) => merged.get(n)?.[0]?.resourceType !== undefined);
        expect(resolved).toEqual([]);
    });

    // The declaration is only true of the reading it was read from. Opcodes 41 and 352 are the worked example:
    // both name a resource on their PSTEE page, while the BG(2)EE reading of 41 documents no resource use and
    // of 352 is "Unused" - so a type transcribed there would resolve against a namespace the effect never uses.
    test("every resource declaration still matches the reading it was transcribed from", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        const drifted = Object.entries(OpcodeResourceOverrides)
            .filter(([n, decl]) => opcodes.get(Number(n)) !== decl.reading)
            .map(([n, decl]) => `${n}: declared for "${decl.reading}", table now says "${opcodes.get(Number(n))}"`);

        expect(drifted).toEqual([]);
    });

    test("the IDS-file map covers the opcodes with no unsuffixed page", () => {
        const merged = buildMergedReadings(OPCODES_DIR);
        // op177 has no unsuffixed page at all, so a filename-driven harvest could never have carried this.
        expect(merged.get(177)?.[0]?.idsFileByParam2?.[4]).toEqual(["RACE"]);
        expect(merged.get(344)?.[0]?.idsFileByParam2?.[9]).toEqual(["KIT"]);
    });
});

/**
 * An opcode number means whatever each engine makes it mean, and IESDP writes one page per reading; the
 * unsuffixed `opNNN.html` filename carries no authority (`op025.html` covers BG2 alone, `op283.html` Icewind
 * Dale alone). The tables therefore describe ONE chosen reading - BG(2)EE - selected from each page's own
 * availability matrix. These pin that choice, and the coverage that reading a single filename pattern lost.
 */
describe("engine reading selection", () => {
    test("picks the BG(2)EE reading where engines disagree about the opcode", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        // Each of these numbers was reused: the Icewind Dale pages say Stat: Save vs. all / Text: Float Text /
        // State: Hold, and those pages happen to own the unsuffixed filename for two of the three.
        expect(opcodes.get(238)).toBe("Death: Disintegrate");
        expect(opcodes.get(283)).toBe("Use EFF File (Cursed)");
        expect(opcodes.get(109)).toBe("State: Paralyze");
    });

    test("picks the BG(2)EE parameter labels too, not the unsuffixed page's", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // op025.html is the BG2 reading ("Damage Amount"); op025-bgee.html is the EE one.
        expect(rels.get(25)?.[0]?.param1?.label).toBe("Amount_1");
    });

    test("an opcode with no unsuffixed page still gets a name and parameter labels", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // op177 exists only as op177-bg2/-bgee/-iwd2/-pst/-bg1-derived.
        expect(opcodes.get(177)).toBe("Use EFF File");
        expect(rels.get(177)?.[0]?.param1?.label).toBe("IDS Entry");
        expect(rels.get(177)?.[0]?.param2?.label).toBe("IDS File");
    });

    test("covers the EE and IWD2 ranges, which have no unsuffixed pages at all", () => {
        const opcodes = extractOpcodes(OPCODES_DIR);
        expect(opcodes.get(328)).toBe("State: Set Extended or Spell State");
        expect(opcodes.get(457)).toBe("Spell Effect: Rapid Shot");
    });

    test("another page of the SAME reading fills a slot the chosen page omits", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // Both op025 pages read the opcode as State: Poison; only one writes param3/param4.
        expect(rels.get(25)?.[0]?.param3?.label).toBe("Amount_2");
        expect(rels.get(25)?.[0]?.param4?.label).toBe("Frequency Multiplier");
    });

    test("a page describing a DIFFERENT reading donates nothing", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // 260 is Spell Sequencer Activation on the EE, Graphics: Animation Removal on IWD1, and "Crash" on BG2.
        // Only the chosen reading's own pages may contribute, so no IWD label leaks in.
        expect(rels.get(260)?.[0]?.param1?.label).not.toBe("Graphics: Animation Removal");
        expect(rels.get(260)?.[0]?.param2?.label).not.toMatch(/animation/i);
    });

    test("availability is the union over every reading - which engines have the opcode at all", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // op001.html's own matrix says bgee:false because that page describes the pre-EE reading; the opcode
        // exists on the EE all the same, which its own page states.
        expect(rels.get(1)?.[0]?.availability).toMatchObject({ bg1: true, bgee: true });
        // Each op177 page declares only its own engine, so only the union says where it exists.
        expect(rels.get(177)?.[0]?.availability).toMatchObject({ bg1: true, bg2: true, bgee: true, iwd2: true });
    });

    test("frontmatter labels are decoded, not passed through as HTML entities", () => {
        const rels = extractOpcodeReadings(OPCODES_DIR);
        // op012-bgee.html writes `param2: "Mode &amp; Damage Type"`.
        expect(rels.get(12)?.[0]?.param2?.label).toBe("Mode & Damage Type");
        expect(Object.values(rels.get(12) ?? {}).some((v) => JSON.stringify(v).includes("&amp;"))).toBe(false);
    });
});
