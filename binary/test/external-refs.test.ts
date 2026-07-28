import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { effParser } from "../src/eff";
import { itmParser } from "../src/itm";
import { splParser } from "../src/spl";
import { REPO_ROOT } from "./repo-root";
import type { ParsedField, ParsedGroup } from "../src/types";

const ITM_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/itm/wm_sbook.itm");
const CRE_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/BGT-WeiDU/bgt/fixpack/iron15.cre");

/** Every field in the display tree, flattened - strrefs sit at several depths (CRE's are header scalars plus
 *  the 100 sound slots, which are array children). */
function allFields(group: ParsedGroup): ParsedField[] {
    const out: ParsedField[] = [];
    for (const child of group.fields) {
        if ("fields" in child) out.push(...allFields(child));
        else out.push(child);
    }
    return out;
}

function parseFields(parser: { parse: (b: Uint8Array) => { root: ParsedGroup } }, fixture: string): ParsedField[] {
    return allFields(parser.parse(new Uint8Array(fs.readFileSync(fixture))).root);
}

const SPL_FIXTURE = path.join(REPO_ROOT, "external/infinity-engine/bg2-wildmage/wildmage/wild_spells/spl/wm_word.spl");
const EFF_FIXTURE = path.join(
    REPO_ROOT,
    "external/infinity-engine/Ascension/ascension/ascensionmain/demon/babausu.eff",
);

const haveFixtures = fs.existsSync(ITM_FIXTURE) && fs.existsSync(CRE_FIXTURE);
const have2daFixtures = haveFixtures && fs.existsSync(SPL_FIXTURE) && fs.existsSync(EFF_FIXTURE);

const isStrref = (f: ParsedField): boolean => f.ref?.kind === "strref";

/** The IDS tables a field declares, or undefined when it declares no IDS ref. */
function idsTables(f: ParsedField): readonly string[] | undefined {
    return f.ref?.kind === "ids" ? f.ref.tables : undefined;
}

// The flag is what tells a consumer holding the game's dialog.tlk which numbers are resolvable, so it has to
// survive the spec -> walk -> display-tree path, not merely exist on the spec.
describe.skipIf(!haveFixtures)("strref fields reach the display tree", () => {
    it("marks all four ITM header strrefs and nothing else", () => {
        const marked = parseFields(itmParser, ITM_FIXTURE).filter((f) => isStrref(f));

        expect(marked.map((f) => f.name)).toEqual([
            "Unidentified Name",
            "Identified Name",
            "Unidentified Desc",
            "Identified Desc",
        ]);
        // Still plain signed numbers - the flag adds resolvability, it does not change how the value is stored
        // or edited (a strref that changed type would break every numeric control and the byte round-trip).
        expect(marked.every((f) => f.type === "int32")).toBe(true);
    });

    it("marks the CRE name strrefs and every sound-set slot", () => {
        const marked = parseFields(creParser, CRE_FIXTURE).filter((f) => isStrref(f));

        // 2 header names + the 100-slot sound-set block, which reaches the tree as array children - the path a
        // per-field spec property is easiest to lose on.
        expect(marked).toHaveLength(102);
        expect(marked.slice(0, 2).map((f) => f.name)).toEqual(["Long Name", "Short Name"]);
    });

    // The library never names these slots itself: the mapping is per-install (BG1 SOUNDOFF.IDS vs BG2
    // SNDSLOT.IDS, plus mod extensions), so it emits which table names the slot and at which index, and a
    // consumer holding the game resolves it. Ordered by preference - SNDSLOT is BG2's, SOUNDOFF is BG1's.
    it("tells a consumer which IDS table names each CRE sound slot", () => {
        const slots = parseFields(creParser, CRE_FIXTURE).filter((f) => f.slotRef !== undefined);
        const sndslot = { kind: "ids", tables: ["SNDSLOT", "SOUNDOFF"] };

        expect(slots).toHaveLength(100);
        expect(slots[0]?.slotRef).toEqual({ ref: sndslot, index: 0 });
        expect(slots[99]?.slotRef).toEqual({ ref: sndslot, index: 99 });
    });

    // A sound slot is BOTH: its value resolves through the TLK and its label through an IDS table. Consumers
    // have to apply both, and a fixture carrying only one property cannot catch a consumer that stops after
    // the first - which is exactly how the pre-migration two-mechanism code dropped the label.
    it("carries value ref and slot ref together on one sound slot", () => {
        const slot = parseFields(creParser, CRE_FIXTURE).find((f) => f.slotRef !== undefined);

        expect(slot?.ref).toEqual({ kind: "strref" });
        expect(slot?.slotRef?.ref).toEqual({ kind: "ids", tables: ["SNDSLOT", "SOUNDOFF"] });
    });

    // Pins the constant `client/src/ie-resources/tree-provider.ts` reads raw for its hover tooltip: it grabs the
    // name strref at a fixed offset rather than parsing a whole record per hover, so if a format ever moved that
    // field the tooltip would silently resolve the wrong string.
    it("keeps the record's name strref at offset 8, where the tree tooltip reads it", () => {
        const itmName = parseFields(itmParser, ITM_FIXTURE).find((f) => isStrref(f));
        const creName = parseFields(creParser, CRE_FIXTURE).find((f) => isStrref(f));

        expect(itmName?.offset).toBe(8);
        expect(creName?.offset).toBe(8);
    });
});

// These values are IDS-backed: the vendored enum is a small baseline (8 races) while the install's own
// RACE.IDS carries 82 and mods extend it further, so the field declares which table names it and a consumer
// holding the game merges that in. Declaring it here is what makes the whole set reachable without the client
// keeping its own field-to-table map.
describe.skipIf(!haveFixtures)("IDS-backed CRE fields declare their table", () => {
    it("declares the naming table for every game-defined header field", () => {
        const declared = parseFields(creParser, CRE_FIXTURE)
            .filter((f) => idsTables(f) !== undefined)
            .map((f) => [f.name, idsTables(f)] as const);

        expect(Object.fromEntries(declared)).toEqual({
            Sex: ["GENDER"],
            Gender: ["GENDER"],
            "Enemy Ally": ["EA"],
            General: ["GENERAL"],
            Specific: ["SPECIFIC"],
            Race: ["RACE"],
            "Racial Enemy": ["RACE"],
            Class: ["CLASS"],
            Alignment: ["ALIGNMEN"],
            Kit: ["KIT"],
            "Animation Id": ["ANIMATE"],
        });
    });

    // KIT.IDS is keyed by the bare kit id while the field stores it in the dword's high word, so the
    // declaration carries the shift between the two - corpus-verified, see the spec comment.
    it("declares the shift between KIT.IDS keys and the stored kit dword", () => {
        const kit = parseFields(creParser, CRE_FIXTURE).find((f) => f.name === "Kit");

        expect(kit?.ref).toEqual({ kind: "ids", tables: ["KIT"], keyShift: 16 });
    });

    // Additive, not a replacement: the vendored table stays as the fallback for a record opened outside a game,
    // and the field stays an open enum so a value no table names is still editable.
    it("keeps the vendored table and open-enum behaviour alongside the declaration", () => {
        const race = parseFields(creParser, CRE_FIXTURE).find((f) => f.name === "Race");

        expect(race?.enumOptions?.["1"]).toBe("HUMAN");
        expect(race?.enumOpen).toBe(true);
    });
});

/**
 * The magic school and secondary type are 2DA-backed, and the SAME pair appears in three formats (SPL header,
 * ITM ability, EFF body) through one shared vendored table. Declaring the ref on only some of them would name
 * the value in one editor and not another, so this pins the whole cohort against real parses.
 *
 * The stored value is the 2DA's ROW INDEX and the row NAME is the identifier - MSCHOOL row 1 is ABJURER - so
 * the reader maps index to name (see `archive/two-da.ts`).
 */
describe.skipIf(!have2daFixtures)("2DA-backed school/sectype fields declare their table", () => {
    const refFor = (fields: ParsedField[], name: string): unknown => fields.find((f) => f.name === name)?.ref;
    const school = { kind: "2da", tables: ["MSCHOOL"] };
    const sectype = { kind: "2da", tables: ["MSECTYPE"] };

    it("declares MSCHOOL and MSECTYPE on the ITM ability pair", () => {
        const fields = parseFields(itmParser, ITM_FIXTURE);

        expect(refFor(fields, "Primary Type")).toEqual(school);
        expect(refFor(fields, "Secondary Type")).toEqual(sectype);
    });

    it("declares the same pair on the SPL header", () => {
        const fields = parseFields(splParser, SPL_FIXTURE);

        expect(refFor(fields, "School")).toEqual(school);
        expect(refFor(fields, "Sectype")).toEqual(sectype);
    });

    it("declares the same pair on the EFF body", () => {
        const fields = parseFields(effParser, EFF_FIXTURE);

        expect(refFor(fields, "School")).toEqual(school);
        expect(refFor(fields, "Sectype")).toEqual(sectype);
    });
});
