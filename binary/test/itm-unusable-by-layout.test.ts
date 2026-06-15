/**
 * The ITM "Unusable By" and "Unusable By Kit" panels regroup their bitflags by *semantic category*
 * (alignment / class / race for usability; base class for kits) rather than by the wire-format byte that
 * stores them. Because a category's bits are scattered across all four bytes, each panel renders through the
 * `flagGroups` block, whose checkboxes each carry their own backing field + bit mask. These tests lock the
 * cross-byte membership so a future edit can't silently drop a flag back into a by-byte column.
 */

import { describe, expect, it } from "vitest";
import { itmLayout } from "../src/itm/layout-schema";

type Block = Record<string, unknown>;

function generalPanels(): Array<{ title?: string; blocks: Block[] }> {
    const variant = itmLayout.variants.item;
    if (!variant) throw new Error("ITM layout has no item variant");
    const general = (variant.tabs ?? []).find((t) => t.id === "general");
    if (!general) throw new Error("ITM layout has no General tab");
    return (general.rows ?? []).flatMap((r) => r.panels) as Array<{ title?: string; blocks: Block[] }>;
}

function panelBlock(title: string): Block {
    const panel = generalPanels().find((p) => p.title === title);
    if (!panel) throw new Error(`No "${title}" panel`);
    return panel.blocks[0]!;
}

interface FlagItem {
    field: string;
    mask: number;
    label?: string;
}
const columnsOf = (block: Block): Array<Array<{ label: string; items: FlagItem[] }>> =>
    block.columns as Array<Array<{ label: string; items: FlagItem[] }>>;

/** Flatten a flagGroups block to `${field}:${mask}` -> group label, so membership is easy to assert. */
function groupByItem(block: Block): Map<string, string> {
    const out = new Map<string, string>();
    for (const col of columnsOf(block)) {
        for (const group of col) {
            for (const item of group.items) out.set(`${item.field}:${item.mask}`, group.label);
        }
    }
    return out;
}

/** The display label for a `${field}:${mask}` item (the block's override, if any). */
function labelByItem(block: Block): Map<string, string | undefined> {
    const out = new Map<string, string | undefined>();
    for (const col of columnsOf(block)) {
        for (const group of col) {
            for (const item of group.items) out.set(`${item.field}:${item.mask}`, item.label);
        }
    }
    return out;
}

const hk = (k: string): string => `itm.header.${k}`;

describe("ITM Unusable By panel groups bits by category across bytes", () => {
    it("renders through the flagGroups block, not per-byte flags blocks", () => {
        expect(panelBlock("Unusable By").kind).toBe("flagGroups");
    });

    it("exposes select-all / deselect-all (bulkSelect) on both flag panels", () => {
        expect(panelBlock("Unusable By").bulkSelect).toBe(true);
        expect(panelBlock("Unusable By Kit").bulkSelect).toBe(true);
    });

    it("Alignment / Class / Race are the three column groups", () => {
        const labels = new Set(groupByItem(panelBlock("Unusable By")).values());
        expect(labels).toEqual(new Set(["Alignment", "Class", "Race"]));
    });

    it("class flags from byte1 (Bard/Cleric) and byte4 (Monk) land in Class, not their storage byte's column", () => {
        const g = groupByItem(panelBlock("Unusable By"));
        // Bard = byte1 (ClassAlignment) bit 0x40; Cleric = byte1 0x80; Monk = byte4 (Race) 0x20.
        expect(g.get(`${hk("usabilityFlags.byte1ClassAlignment")}:${0x40}`)).toBe("Class");
        expect(g.get(`${hk("usabilityFlags.byte1ClassAlignment")}:${0x80}`)).toBe("Class");
        expect(g.get(`${hk("usabilityFlags.byte4Race")}:${0x20}`)).toBe("Class");
    });

    it("Elf (byte3, stored with the classes) lands in Race", () => {
        const g = groupByItem(panelBlock("Unusable By"));
        expect(g.get(`${hk("usabilityFlags.byte3ClassRace")}:${0x80}`)).toBe("Race");
    });
});

describe("ITM Unusable By Kit panel groups kits by base class across bytes", () => {
    it("renders through the flagGroups block", () => {
        expect(panelBlock("Unusable By Kit").kind).toBe("flagGroups");
    });

    it("Fighter kits drawn from byte1 (Barbarian) and byte4 (Berserker) share one Fighter group", () => {
        const g = groupByItem(panelBlock("Unusable By Kit"));
        expect(g.get(`${hk("kitUsability1")}:${0x40}`)).toBe("Fighter"); // Barbarian
        expect(g.get(`${hk("kitUsability4")}:${0x01}`)).toBe("Fighter"); // Berserker
    });

    it("Mage kits span byte1 (Wild Mage), byte3 (schools) and byte4 (Abjurer/Conjurer)", () => {
        const g = groupByItem(panelBlock("Unusable By Kit"));
        expect(g.get(`${hk("kitUsability1")}:${0x80}`)).toBe("Mage"); // Wild Mage
        expect(g.get(`${hk("kitUsability3")}:${0x01}`)).toBe("Mage"); // Diviner
        expect(g.get(`${hk("kitUsability4")}:${0x80}`)).toBe("Mage"); // Conjurer
    });

    it("byte3 bit 7 is the 'Feralan' ranger kit (renamed from the garbled 'Ferlain')", () => {
        const block = panelBlock("Unusable By Kit");
        expect(groupByItem(block).get(`${hk("kitUsability3")}:${0x80}`)).toBe("Ranger");
        expect(labelByItem(block).get(`${hk("kitUsability3")}:${0x80}`)).toBe("Feralan");
    });
});
