import type { FlatNode, Model } from "../model";

/** Normalize a display label to a match key: lowercase, strip non-alphanumerics.
 *  "Memorized Spell Count" -> "memorizedspellcount". Mirrors the ITM/SPL fixture helper so the
 *  relationship checks match walkStruct's humanized labels regardless of spacing/capitalization. */
export function normKey(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

/** Numeric value of a field node: enum/flag fields carry the code in `rawValue`, plain numerics in `value`. */
export function fieldNumber(node: FlatNode): number | undefined {
    const src = node.source as { value?: unknown; rawValue?: unknown };
    const v = src.rawValue ?? src.value;
    return typeof v === "number" ? v : undefined;
}

/** String value of a field node (e.g. a ResRef). Undefined when the field is not string-typed. */
export function fieldText(node: FlatNode): string | undefined {
    const src = node.source as { value?: unknown };
    return typeof src.value === "string" ? src.value : undefined;
}

/** First group node with the given exact display name (top-level group labels are unique in these formats). */
export function findGroup(model: Model, name: string): FlatNode | undefined {
    return model.nodes.find((n) => n.kind === "group" && n.name === name);
}

/** Direct child group nodes of a group. */
export function childGroups(model: Model, group: FlatNode): FlatNode[] {
    return (model.childrenByParent.get(group.id) ?? []).map((i) => model.nodes[i]!).filter((n) => n.kind === "group");
}

/** Direct child field nodes of a group. */
export function childFields(model: Model, group: FlatNode): FlatNode[] {
    return (model.childrenByParent.get(group.id) ?? []).map((i) => model.nodes[i]!).filter((n) => n.kind === "field");
}

/** Child field nodes of a group keyed by normalized name. */
export function fieldsByKey(model: Model, group: FlatNode): Map<string, FlatNode> {
    const map = new Map<string, FlatNode>();
    for (const f of childFields(model, group)) map.set(normKey(f.name), f);
    return map;
}
