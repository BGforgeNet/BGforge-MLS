import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { mapParser, type ParseResult } from "@bgforge/binary";
import { buildModel } from "../src/model";
import { buildLayout } from "../src/layout";
import type { ResolvedLayout } from "../src/types";
import { itmFixturePresent, openItmSession } from "./ie-fixture";

const MAP_FIXTURE = path.resolve(__dirname, "../../client/testFixture/maps/arcaves.map");

/** Minimal ParseResult carrying a single empty depth-0 group (no children), stamped with the map variant so
 *  the layout resolves. Used to prove the caps for an empty variable section come from the layout block, not
 *  from probing a representative entry (which the retired adapter predicates needed). */
function emptyGroupParseResult(groupName: string): ParseResult {
    return {
        format: "map",
        formatName: "MAP",
        variantId: "map",
        root: { name: "Root", fields: [{ name: groupName, fields: [] }] },
    };
}

/** The render mode of a `list` block, found by section key across the variant's rows. */
function listRender(layout: ResolvedLayout, sectionKey: string): "inline" | "master-detail" | undefined {
    const rows =
        layout.rows ?? (layout.tabs ?? []).flatMap((t) => t.rows ?? (t.tabs ?? []).flatMap((st) => st.rows ?? []));
    for (const row of rows) {
        for (const panel of row.panels) {
            for (const block of panel.blocks) {
                if (block.kind === "list" && block.sectionKey === sectionKey) return block.render;
            }
        }
    }
    return undefined;
}

describe("buildLayout (map)", () => {
    it("resolves the map layout with Global Variables as an inline list section", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        const layout = buildLayout("map", m);
        expect(layout.formatId).toBe("map");
        expect(layout.layout?.variantId).toBe("map");
        expect(layout.layout?.sections["Global Variables"]).toBeDefined();
        expect(listRender(layout.layout!, "Global Variables")).toBe("inline");
    });
});

describe("buildLayout capabilities", () => {
    it("marks Global Variables addable + modifiable (caps declared on the list block)", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        const gv = buildLayout("map", m).layout?.sections["Global Variables"];
        expect(gv?.canAdd).toBe(true);
        expect(gv?.canModify).toBe(true);
    });

    it("does not expose the Header group as a list section (only `list` blocks populate the sections map)", () => {
        const m = buildModel(mapParser.parse(new Uint8Array(fs.readFileSync(MAP_FIXTURE))));
        expect(buildLayout("map", m).layout?.sections["Header"]).toBeUndefined();
    });
});

describe("buildLayout: empty list section caps are count-independent", () => {
    it("reports canAdd/canModify for an empty Local Variables section (caps from the layout block)", () => {
        // The retired adapter entry-probe returned canModify === false for a zero-entry section because there
        // was no representative child to pass to isRemovableEntry. Caps now come from the `list` block, so an
        // empty section still reports its declared affordances.
        const m = buildModel(emptyGroupParseResult("Local Variables"));
        const lv = buildLayout("map", m).layout?.sections["Local Variables"];
        expect(lv).toBeDefined();
        expect(lv?.canModify).toBe(true);
        expect(lv?.canAdd).toBe(true);
    });
});

describe("buildLayout (itm): dual-purpose header label", () => {
    // The 0x10 resref slot is "Replacement item" in BG1/BG2/BGEE but the drop sound in PSTEE. The discriminator
    // is the game, not an in-file field, so no overlay can flip it - a static dual label names both readings
    // (matching the CRE powerLevelOrXp = "Power Level / XP" precedent). Assert the rendered field name.
    it("labels the 0x10 resref slot for both readings (Replacement item / drop sound)", () => {
        if (!itmFixturePresent()) return;
        const layout = buildLayout("itm", openItmSession().model).layout!;
        expect(layout.fields["itm.header.replacement"]?.name).toBe("Replacement / Drop Sound");
    });
});

describe("buildLayout (cre): Spells tab total", () => {
    // A minimal CRE carrying just the two spell sections (depth-0 groups) the Spells-tab count reads.
    function creWithSpellCounts(known: number, memorized: number): ParseResult {
        const kids = (prefix: string, n: number) =>
            Array.from({ length: n }, (_v, i) => ({ name: `${prefix} ${i + 1}`, fields: [] }));
        return {
            format: "cre",
            formatName: "CRE",
            variantId: "creature",
            root: {
                name: "CRE File",
                fields: [
                    { name: "Known Spells", fields: kids("Known Spell", known) },
                    { name: "Memorized Spells", fields: kids("Memorized Spell", memorized) },
                ],
            },
        };
    }

    it("shows total known/memorized on the Spells tab", () => {
        const layout = buildLayout("cre", buildModel(creWithSpellCounts(3, 5))).layout!;
        const spells = (layout.tabs ?? []).find((t) => t.label === "Spells")!;
        expect(spells.count).toBe("3/5");
    });
});
