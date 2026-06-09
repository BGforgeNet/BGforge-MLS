// Shared synthetic fixtures + node-lookup helpers for the cross-record relationship checks.
// Not a *.test.ts file, so vitest does not collect it as a suite (mirrors ie-fixture.ts).

import type { ParseResult } from "@bgforge/binary";
import type { FlatNode, Model } from "../src/model";

export { buildModel } from "../src/model";

const f = (name: string, value: number) => ({ name, value, rawValue: value });
const s = (name: string, value: string) => ({ name, value });
const g = (name: string, fields: unknown[]) => ({ name, fields });

export interface CreOpts {
    memSpells: number;
    items: number;
    slots: number[];
    meminfos: { start: number; count: number }[];
    /** Per-item ResRef label (the item's `item` field). Defaults to a generated `ITEMi` when absent. */
    itemNames?: string[];
    /** Use the parser's real slot labels for the slots the weapon dropdowns key on (instead of `Slot i`). */
    realSlotLabels?: boolean;
}

// Mirrors the parser's CRE_ITEM_SLOT_LABELS for the slots the weapon dropdowns match by name. The real-parser
// test in binary/test/cre-rebuild.test.ts asserts these exact names appear in parser output, so this map cannot
// silently drift from the producer.
const REAL_SLOT_LABELS: Readonly<Record<number, string>> = {
    9: "Weapon 1",
    10: "Weapon 2",
    11: "Weapon 3",
    12: "Weapon 4",
    38: "Selected weapon",
    39: "Selected weapon ability",
};

function slotLabel(i: number, real: boolean): string {
    return real ? (REAL_SLOT_LABELS[i] ?? `Slot ${i}`) : `Slot ${i}`;
}

/** Build a synthetic CRE ParseResult with the faithful group labels the constraints match on.
 *  Cast to ParseResult: this is a structural subset (buildModel reads only `format` and `root.fields`),
 *  and the "cre" adapter declares no hide/projection hooks, so projection is identity. */
export function creResult(o: CreOpts): ParseResult {
    return {
        format: "cre",
        formatName: "CRE",
        root: g("CRE File", [
            g(
                "Memorized Spells",
                Array.from({ length: o.memSpells }, (_, i) => g(`Memorized Spell ${i + 1}`, [f("Spell", i)])),
            ),
            g(
                "Spell Memorization Info",
                o.meminfos.map((mi, i) =>
                    g(`Spell Memorization Info ${i + 1}`, [
                        f("First Memorized Spell Index", mi.start),
                        f("Memorized Spell Count", mi.count),
                    ]),
                ),
            ),
            g(
                "Items",
                Array.from({ length: o.items }, (_, i) =>
                    g(`Item ${i + 1}`, [s("Item", o.itemNames?.[i] ?? `ITEM${i}`), f("Quantity", 1)]),
                ),
            ),
            g(
                "Item Slots",
                o.slots.map((v, i) => f(slotLabel(i, o.realSlotLabels === true), v)),
            ),
        ]),
    } as unknown as ParseResult;
}

/** Locate the Nth child group of a top-level group, then a named field within it (by humanized label). */
export function findGroupNode(model: Model, topGroupName: string, childIndex: number, fieldName: string): FlatNode {
    const top = model.nodes.find((n) => n.kind === "group" && n.name === topGroupName);
    if (!top) throw new Error(`no group "${topGroupName}"`);
    const childGroups = (model.childrenByParent.get(top.id) ?? [])
        .map((i) => model.nodes[i]!)
        .filter((n) => n.kind === "group");
    const child = childGroups[childIndex];
    if (!child) throw new Error(`no child group ${childIndex} in "${topGroupName}"`);
    const field = (model.childrenByParent.get(child.id) ?? [])
        .map((i) => model.nodes[i]!)
        .find((n) => n.kind === "field" && n.name === fieldName);
    if (!field) throw new Error(`no field "${fieldName}" in child ${childIndex} of "${topGroupName}"`);
    return field;
}

/** Locate a named FIELD child directly under a top-level group (e.g. an item slot). */
export function findGroupNodeField(model: Model, topGroupName: string, fieldName: string): FlatNode {
    const top = model.nodes.find((n) => n.kind === "group" && n.name === topGroupName);
    if (!top) throw new Error(`no group "${topGroupName}"`);
    const field = (model.childrenByParent.get(top.id) ?? [])
        .map((i) => model.nodes[i]!)
        .find((n) => n.kind === "field" && n.name === fieldName);
    if (!field) throw new Error(`no field "${fieldName}" under "${topGroupName}"`);
    return field;
}
