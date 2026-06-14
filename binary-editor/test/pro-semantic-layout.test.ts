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

function groupsOf(v: LayoutVariant): { label: string; fields: string[] }[] {
    return blocksOf(v).flatMap((b) => (b.kind === "group" ? [{ label: b.label, fields: b.fields }] : []));
}

function fieldsOf(v: LayoutVariant): string[] {
    return blocksOf(v).flatMap((b) => (b.kind === "fields" ? b.fields : []));
}

describe("PRO weapon: damage range join", () => {
    it("folds minDamage/maxDamage into a single 'X - Y' damage cell", () => {
        const damage = joinsOf(variant("item.weapon")).find((j) => j.label === "Damage");
        expect(damage, "weapon has a Damage join").toBeDefined();
        expect(damage!.fields).toEqual(["pro.weaponStats.minDamage", "pro.weaponStats.maxDamage"]);
        expect(damage!.separator).toBe(" - ");
    });
});

describe("PRO weapon: attack-mode groups", () => {
    it("fuses each attack mode with its AP cost and range into a boxed group", () => {
        const groups = groupsOf(variant("item.weapon"));
        const primary = groups.find((g) => g.label === "Primary Attack");
        const secondary = groups.find((g) => g.label === "Secondary Attack");
        expect(primary, "weapon has a Primary Attack group").toBeDefined();
        expect(secondary, "weapon has a Secondary Attack group").toBeDefined();
        expect(primary!.fields).toEqual([
            "pro.itemProperties.attackModePrimary",
            "pro.weaponStats.apCost1",
            "pro.weaponStats.maxRange1",
        ]);
        expect(secondary!.fields).toEqual([
            "pro.itemProperties.attackModeSecondary",
            "pro.weaponStats.apCost2",
            "pro.weaponStats.maxRange2",
        ]);
    });

    it("removes the grouped fields from the plain Item Properties / Weapon fields blocks", () => {
        const plain = fieldsOf(variant("item.weapon"));
        for (const moved of [
            "pro.itemProperties.attackModePrimary",
            "pro.itemProperties.attackModeSecondary",
            "pro.weaponStats.apCost1",
            "pro.weaponStats.apCost2",
            "pro.weaponStats.maxRange1",
            "pro.weaponStats.maxRange2",
        ]) {
            expect(plain, `${moved} moved into a group`).not.toContain(moved);
        }
    });
});
