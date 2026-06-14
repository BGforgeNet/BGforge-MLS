/**
 * Semantic-representation assertions for the PRO declarative layout: composite presentations that fuse
 * several raw fields into one meaningful display (damage range join, attack-mode groups, drug matrix, ammo
 * damage-mod join). These assert the layout STRUCTURE carries the composite; `layout-sync.test.ts` separately
 * proves every referenced key resolves against a real parsed proto, so a wrong key fails there, not here.
 */

import { describe, expect, it } from "vitest";
import {
    formatAdapterRegistry,
    variantRows,
    type FormatLayout,
    type LayoutBlock,
    type LayoutVariant,
} from "@bgforge/binary";

function proLayout(): FormatLayout {
    const layout = formatAdapterRegistry.get("pro")?.layout;
    if (!layout) throw new Error("pro adapter has no layout");
    return layout;
}

function variant(id: string): LayoutVariant {
    const v = proLayout().variants[id];
    if (!v) throw new Error(`pro layout has no variant ${id}`);
    return v;
}

function blocksOf(v: LayoutVariant): LayoutBlock[] {
    return variantRows(v)
        .flatMap((r) => r.panels)
        .flatMap((p) => p.blocks);
}

function joinsOf(v: LayoutVariant): { label: string; fields: string[]; separator: string | string[] }[] {
    return blocksOf(v).flatMap((b) => (b.kind === "fields" || b.kind === "group" ? (b.joins ?? []) : []));
}

describe("PRO weapon: damage range join", () => {
    it("folds minDamage/maxDamage into a single 'X - Y' damage cell", () => {
        const damage = joinsOf(variant("item.weapon")).find((j) => j.label === "Damage");
        expect(damage, "weapon has a Damage join").toBeDefined();
        expect(damage!.fields).toEqual(["pro.weaponStats.minDamage", "pro.weaponStats.maxDamage"]);
        expect(damage!.separator).toBe(" - ");
    });
});
