import { OpcodeRelationships } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { FieldOverride, RelationshipModel } from "./types";

const PARAM_FIELDS = new Set(["parameter1", "parameter2"]);

function fieldValue(node: FlatNode): number | undefined {
    const v = (node.source as { value?: unknown }).value;
    return typeof v === "number" ? v : undefined;
}

function siblingValue(model: Model, node: FlatNode, name: string): number | undefined {
    const sibs = model.childrenByParent.get(node.parentId ?? "") ?? [];
    const matchIdx = sibs.find((i) => {
        const n = model.nodes[i];
        return n?.name === name && n.kind === "field";
    });
    // matchIdx is an index into model.nodes that was placed there by buildModel - always valid.
    return matchIdx !== undefined ? fieldValue(model.nodes[matchIdx]!) : undefined;
}

function availabilitySummary(avail?: Readonly<Record<string, boolean>>): string | undefined {
    if (!avail) return;
    const on = Object.entries(avail)
        .filter(([, v]) => v)
        .map(([k]) => k.toUpperCase());
    return on.length ? `Engines: ${on.join(", ")}` : undefined;
}

export const ieEffectsModel: RelationshipModel = {
    formatId: "ie-effects",
    fieldOverride(model, node) {
        if (node.kind !== "field") return;
        if (node.name === "opcode") {
            const opcode = fieldValue(node);
            const desc =
                opcode === undefined ? undefined : availabilitySummary(OpcodeRelationships[opcode]?.availability);
            return desc ? { description: desc } : undefined;
        }
        if (!PARAM_FIELDS.has(node.name)) return;
        const opcode = siblingValue(model, node, "opcode");
        if (opcode === undefined) return;
        const rel = OpcodeRelationships[opcode];
        const slot = node.name === "parameter1" ? rel?.param1 : rel?.param2;
        if (!slot) return;
        const override: FieldOverride = {};
        if (slot.label) override.label = slot.label;
        if (slot.enum) {
            override.enumOptions = Object.fromEntries(Object.entries(slot.enum).map(([k, v]) => [k, v]));
            override.presentationType = "enum";
        }
        return Object.keys(override).length > 0 ? override : undefined;
    },
    dependents: () => [], // implemented in a later task
    constraints: () => [], // implemented in a later task
};
