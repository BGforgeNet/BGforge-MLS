import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { creParser } from "../src/cre";
import { itmParser } from "../src/itm";
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

const haveFixtures = fs.existsSync(ITM_FIXTURE) && fs.existsSync(CRE_FIXTURE);

// The flag is what tells a consumer holding the game's dialog.tlk which numbers are resolvable, so it has to
// survive the spec -> walk -> display-tree path, not merely exist on the spec.
describe.skipIf(!haveFixtures)("strref fields reach the display tree", () => {
    it("marks all four ITM header strrefs and nothing else", () => {
        const marked = parseFields(itmParser, ITM_FIXTURE).filter((f) => f.strref === true);

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
        const marked = parseFields(creParser, CRE_FIXTURE).filter((f) => f.strref === true);

        // 2 header names + the 100-slot sound-set block, which reaches the tree as array children - the path a
        // per-field spec property is easiest to lose on.
        expect(marked).toHaveLength(102);
        expect(marked.slice(0, 2).map((f) => f.name)).toEqual(["Long Name", "Short Name"]);
    });

    // The library never names these slots itself: the mapping is per-install (BG1 SOUNDOFF.IDS vs BG2
    // SNDSLOT.IDS, plus mod extensions), so it emits which table names the slot and at which index, and a
    // consumer holding the game resolves it. Ordered by preference - SNDSLOT is BG2's, SOUNDOFF is BG1's.
    it("tells a consumer which IDS table names each CRE sound slot", () => {
        const slots = parseFields(creParser, CRE_FIXTURE).filter((f) => f.idsSlot !== undefined);

        expect(slots).toHaveLength(100);
        expect(slots[0]?.idsSlot).toEqual({ tables: ["SNDSLOT", "SOUNDOFF"], index: 0 });
        expect(slots[99]?.idsSlot).toEqual({ tables: ["SNDSLOT", "SOUNDOFF"], index: 99 });
    });

    // Pins the constant `client/src/ie-resources/tree-provider.ts` reads raw for its hover tooltip: it grabs the
    // name strref at a fixed offset rather than parsing a whole record per hover, so if a format ever moved that
    // field the tooltip would silently resolve the wrong string.
    it("keeps the record's name strref at offset 8, where the tree tooltip reads it", () => {
        const itmName = parseFields(itmParser, ITM_FIXTURE).find((f) => f.strref === true);
        const creName = parseFields(creParser, CRE_FIXTURE).find((f) => f.strref === true);

        expect(itmName?.offset).toBe(8);
        expect(creName?.offset).toBe(8);
    });
});
