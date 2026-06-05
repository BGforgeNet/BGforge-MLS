import { OpcodeRelationships } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { Diagnostic } from "../types";
import type { FieldOverride, RelationshipModel } from "./types";

const PARAM_FIELDS = new Set(["parameter1", "parameter2"]);

// Display field names are the humanized form of the spec key (walkStruct labels
// `parameter1` as "Parameter1", `opcode` as "Opcode", etc.), so the model matches
// on a normalized key - lowercased with non-alphanumerics stripped - rather than
// the raw spec key. This stays correct regardless of humanize's capitalization
// and spacing ("Max Level" -> "maxlevel") without coupling the model to a fixed
// label spelling.
function normKey(name: string): string {
    return name.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
}

function fieldValue(node: FlatNode): number | undefined {
    // Enum/flag fields carry the numeric code in `rawValue` (their `value` is the
    // resolved display string); plain numerics leave `rawValue` unset. Read
    // `rawValue` first, falling back to `value`.
    const source = node.source as { value?: unknown; rawValue?: unknown };
    const v = source.rawValue ?? source.value;
    return typeof v === "number" ? v : undefined;
}

function siblingValue(model: Model, node: FlatNode, key: string): number | undefined {
    const sibs = model.childrenByParent.get(node.parentId ?? "") ?? [];
    const matchIdx = sibs.find((i) => {
        const n = model.nodes[i];
        return n?.kind === "field" && normKey(n.name) === key;
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
        const key = normKey(node.name);
        if (key === "opcode") {
            const opcode = fieldValue(node);
            const desc =
                opcode === undefined ? undefined : availabilitySummary(OpcodeRelationships[opcode]?.availability);
            return desc ? { description: desc } : undefined;
        }
        if (!PARAM_FIELDS.has(key)) return;
        const opcode = siblingValue(model, node, "opcode");
        if (opcode === undefined) return;
        const rel = OpcodeRelationships[opcode];
        const slot = key === "parameter1" ? rel?.param1 : rel?.param2;
        if (!slot) return;
        const override: FieldOverride = {};
        if (slot.label) override.label = slot.label;
        if (slot.enum) {
            override.enumOptions = Object.fromEntries(Object.entries(slot.enum).map(([k, v]) => [k, v]));
            override.presentationType = "enum";
        }
        return Object.keys(override).length > 0 ? override : undefined;
    },
    dependents(model, editedNode) {
        if (editedNode.kind !== "field" || normKey(editedNode.name) !== "opcode") return [];
        const sibs = model.childrenByParent.get(editedNode.parentId ?? "") ?? [];
        const out: string[] = [];
        for (const i of sibs) {
            const n = model.nodes[i];
            if (n && n.kind === "field" && PARAM_FIELDS.has(normKey(n.name))) out.push(n.id);
        }
        return out;
    },
    constraints(model) {
        const diags: Diagnostic[] = [];
        for (const node of model.nodes) {
            if (node.kind !== "group") continue;
            const childIdx = model.childrenByParent.get(node.id) ?? [];
            const children = childIdx.map((i) => model.nodes[i]).filter((n): n is FlatNode => n !== undefined);
            const byName = (key: string) => children.find((c) => c.kind === "field" && normKey(c.name) === key);
            // Effect-struct detection: group whose direct children include opcode, parameter1, parameter2.
            if (!byName("opcode") || !byName("parameter1") || !byName("parameter2")) continue;
            const p1 = byName("probability1");
            const p2 = byName("probability2");
            if (!p1 || !p2) continue;
            const v1 = fieldValue(p1);
            const v2 = fieldValue(p2);
            // probability1 is the upper bound, probability2 the lower bound; range [p2, p1].
            // If p1 < p2 the range is empty and the effect never fires.
            if (v1 === undefined || v2 === undefined || v1 >= v2) continue;
            diags.push({
                nodeId: p1.id,
                severity: "warning",
                message: "Probability range is empty (upper < lower); effect never applies.",
                quickFix: {
                    label: "Swap probability values",
                    edits: [
                        { nodeId: p1.id, value: v2 },
                        { nodeId: p2.id, value: v1 },
                    ],
                },
            });
        }
        return diags;
    },
};
