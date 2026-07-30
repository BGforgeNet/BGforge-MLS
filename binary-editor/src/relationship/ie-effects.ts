import { OpcodeRelationships } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { Diagnostic } from "../types";
import type { FieldOverride, RelationshipModel } from "./types";
// Display field names are the humanized spec key (walkStruct labels `parameter1` as "Parameter1"), so the model
// matches on a normalized key. `normKey`/`fieldNumber` are the shared helpers; `fieldValue` keeps the local name.
import { normKey, fieldNumber as fieldValue } from "./model-helpers";

type SlotKey = "param1" | "param2" | "param3" | "param4" | "param5" | "special" | "savingthrow" | "power";

/**
 * Effect fields whose meaning the opcode selects, mapped to the slot naming them in `OpcodeRelationships`.
 * parameter1/parameter2 exist on every effect record; the rest are read by a minority of opcodes, and the
 * dword mapped to `special` is the one the spec otherwise calls a TobEx stacking id (two spec names, one
 * field, as with the dice/level pair below).
 */
const SLOT_BY_FIELD = new Map<string, SlotKey>([
    ["parameter1", "param1"],
    ["parameter2", "param2"],
    ["parameter3", "param3"],
    ["parameter4", "param4"],
    ["parameter5", "param5"],
    ["stackingidex", "special"],
    ["stackingidtobex", "special"],
    ["savetype", "savingthrow"],
    ["power", "power"],
]);

/** The two slots the IDS-Entry / IDS-File pair occupies; only these consult `idsFileByParam2`. */
const PARAM_FIELDS = new Set(["parameter1", "parameter2"]);

// The 0x1c/0x20 dword pair is dual-purpose: most opcodes read it as a Maximum/Minimum Level range (the static
// label the layout assigns), but these opcodes read it as the effect's own Dice Thrown/Dice Sides. The field is
// named maxLevel/minLevel in the feature block and diceThrown/diceSides in the EFF v1/v2 body - same field, two
// spec names - so each slot matches either name. (THROWN = 0x1c, SIDES = 0x20.)
const DICE_OPCODES = new Set([12, 17, 18, 331, 333]);
const THROWN_KEYS = new Set(["maxlevel", "dicethrown"]);
const SIDES_KEYS = new Set(["minlevel", "dicesides"]);

/** Whether the dual-purpose pair beside `node` is read as dice (vs a level range) for the effect's opcode.
 *  Opcode 218 is the lone conditional case: it reads dice only when parameter2 = 1 (IESDP). */
function readsDice(model: Model, node: FlatNode): boolean {
    const opcode = siblingValue(model, node, "opcode");
    if (opcode === undefined) return false;
    if (DICE_OPCODES.has(opcode)) return true;
    return opcode === 218 && siblingValue(model, node, "parameter2") === 1;
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
        if (THROWN_KEYS.has(key) || SIDES_KEYS.has(key)) {
            // Dice opcodes flip the static Maximum/Minimum Level label to Dice Thrown/Dice Sides; every other
            // opcode keeps the static level label (no override).
            if (!readsDice(model, node)) return;
            return { label: THROWN_KEYS.has(key) ? "Dice Thrown" : "Dice Sides" };
        }
        if (key === "resource") {
            // What the resref points at is a function of the opcode, so it cannot be declared on the spec (which
            // marks it deferred). Where IESDP names one target type for the opcode, the ref is computed here and
            // the host resolves it through the same path as a declared one.
            const opcode = siblingValue(model, node, "opcode");
            const type = opcode === undefined ? undefined : OpcodeRelationships[opcode]?.resourceType;
            return type === undefined ? undefined : { ref: { kind: "resource", type } };
        }
        if (key === "parentresource") {
            // Unlike the effect's own resource this one is NOT opcode-dependent: the adjacent Parent Resource
            // Type says what it is. Across BG:EE, BG2:ToB and the mod corpus every record with a parent resource
            // also carries a non-zero type, so reading the sibling resolves the field rather than guessing.
            const kind = siblingValue(model, node, "parentresourcetype");
            const type = kind === 1 ? "SPL" : kind === 2 ? "ITM" : undefined;
            return type === undefined ? undefined : { ref: { kind: "resource", type } };
        }
        const slotKey = SLOT_BY_FIELD.get(key);
        if (slotKey === undefined) return;
        const opcode = siblingValue(model, node, "opcode");
        if (opcode === undefined) return;
        const rel = OpcodeRelationships[opcode];
        const slot = rel?.[slotKey];
        const idsFiles = PARAM_FIELDS.has(key) ? rel?.idsFileByParam2 : undefined;
        if (!slot && !idsFiles) return;
        const override: FieldOverride = {};
        if (slot?.label) override.label = slot.label;
        if (slot?.enum) {
            override.enumOptions = Object.fromEntries(Object.entries(slot.enum).map(([k, v]) => [k, v]));
            override.presentationType = "enum";
        }
        if (idsFiles) {
            if (key === "parameter2") {
                // Name the files themselves, so the selector reads as a table rather than a bare number. Derived
                // from the same map the entry resolves through, so the two can never disagree about a slot.
                override.enumOptions = Object.fromEntries(
                    Object.entries(idsFiles).map(([value, tables]) => [value, `${tables[0]}.IDS`]),
                );
                override.presentationType = "enum";
            } else {
                // parameter1 is an entry in whichever table parameter2 currently names. The spec cannot declare
                // this - only here is the sibling visible - so the ref is computed and the host resolves it
                // exactly as it resolves a declared one. An unmapped parameter2 leaves the field a plain
                // number rather than guessing a table.
                const tables = idsFiles[siblingValue(model, node, "parameter2") ?? -1];
                if (tables !== undefined) override.ref = { kind: "ids", tables };
            }
        }
        return Object.keys(override).length > 0 ? override : undefined;
    },
    dependents(model, editedNode) {
        if (editedNode.kind !== "field") return [];
        const editedKey = normKey(editedNode.name);
        // Opcode rewrites the parameter labels AND the dual-purpose dice/level pair. parameter2 flips the pair
        // (opcode 218 reads dice iff parameter2 = 1), and on an IDS-Entry/IDS-File opcode it also chooses the
        // table parameter1 resolves against - so there it re-resolves the params too.
        const editedOpcode = siblingValue(model, editedNode, "opcode");
        const selectsIdsFile =
            editedOpcode !== undefined && OpcodeRelationships[editedOpcode]?.idsFileByParam2 !== undefined;
        // Opcode rewrites every slot label and the resource's target type; parameter2 re-resolves only the
        // IDS-Entry pair; parentResourceType types its own resref and nothing else.
        const wantSlots = editedKey === "opcode" || (editedKey === "parameter2" && selectsIdsFile);
        const wantDiceLevel = editedKey === "opcode" || editedKey === "parameter2";
        const wantResource = editedKey === "opcode";
        const wantParentResource = editedKey === "parentresourcetype";
        if (!wantSlots && !wantDiceLevel && !wantResource && !wantParentResource) return [];
        const sibs = model.childrenByParent.get(editedNode.parentId ?? "") ?? [];
        const out: string[] = [];
        for (const i of sibs) {
            const n = model.nodes[i];
            if (!n || n.kind !== "field") continue;
            const k = normKey(n.name);
            const slotAffected = editedKey === "opcode" ? SLOT_BY_FIELD.has(k) : PARAM_FIELDS.has(k);
            if (
                (wantSlots && slotAffected) ||
                (wantDiceLevel && (THROWN_KEYS.has(k) || SIDES_KEYS.has(k))) ||
                (wantResource && k === "resource") ||
                (wantParentResource && k === "parentresource")
            ) {
                out.push(n.id);
            }
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
    // No cross-record references in the bare effect overlay, so no cascading edits.
    cascade: () => [],
};

// Reusable pieces so the registry can recompose the shared opcode/parameter overlay + probability check with
// per-format cross-record constraints, instead of registering this whole model verbatim for every IE format.
export const ieEffectsFieldOverride = ieEffectsModel.fieldOverride;
export const ieEffectsDependents = ieEffectsModel.dependents;
export const ieEffectsProbabilityConstraint = ieEffectsModel.constraints;
