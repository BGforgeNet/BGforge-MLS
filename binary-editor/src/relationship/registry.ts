import { formatAdapterRegistry } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { Diagnostic, NodeId } from "../types";
import type { FieldOverride, RelationshipModel } from "./types";
import { ieEffectsFieldOverride, ieEffectsDependents, ieEffectsProbabilityConstraint } from "./ie-effects";
import { crossRefDiagnostics, crossRefDependents, crossRefFieldOverride, crossRefCascade } from "./cross-record";
import { creWeaponFieldOverride, creWeaponDependents } from "./cre-weapons";
import { spellbookCapacityDiagnostics } from "../spellbook";

/** An optional format-specific overlay composed AHEAD of the generic ones (its override wins; its dependents
 *  are added). Used for CRE's selected-weapon / ability dropdowns, which are neither IE effects nor index refs. */
interface ExtraOverlay {
    fieldOverride: (model: Model, node: FlatNode) => FieldOverride | undefined;
    dependents: (model: Model, node: FlatNode) => NodeId[];
}

/** Build an IE relationship model: the shared opcode/parameter field overlay + probability check, plus the
 *  format's declarative cross-record relationships (resolved from its `@bgforge/binary` adapter). A format
 *  with an index relationship that names a target label (CRE Item Slots -> Items) also overlays a named-item
 *  dropdown on those slots, falling back to the shared IE overlay for every other field. An optional `extra`
 *  overlay is tried first (CRE weapon dropdowns). */
function ieModel(
    formatId: string,
    extra?: ExtraOverlay,
    extraConstraints?: (model: Model) => Diagnostic[],
): RelationshipModel {
    const rels = formatAdapterRegistry.get(formatId)?.crossRefRelationships ?? [];
    const hasIndexDropdown = rels.some((r) => r.kind === "index" && r.targetLabelField !== undefined);
    const baseOverride = hasIndexDropdown
        ? (model: Model, node: FlatNode) =>
              crossRefFieldOverride(model, node, rels) ?? ieEffectsFieldOverride(model, node)
        : ieEffectsFieldOverride;
    const baseDependents = hasIndexDropdown
        ? (model: Model, node: FlatNode) => [
              ...crossRefDependents(model, node, rels),
              ...ieEffectsDependents(model, node),
          ]
        : ieEffectsDependents;
    return {
        formatId,
        fieldOverride: extra
            ? (model: Model, node: FlatNode) => extra.fieldOverride(model, node) ?? baseOverride(model, node)
            : baseOverride,
        dependents: extra
            ? (model: Model, node: FlatNode) => [...extra.dependents(model, node), ...baseDependents(model, node)]
            : baseDependents,
        constraints: (model: Model) => [
            ...(extraConstraints?.(model) ?? []),
            ...ieEffectsProbabilityConstraint(model),
            ...crossRefDiagnostics(model, rels),
        ],
        // Uniform across formats: `crossRefCascade` is a no-op unless a relationship is `uniqueRef` (only CRE
        // Item Slots today), so every IE format can route through it.
        cascade: (model: Model, node: FlatNode) => crossRefCascade(model, node, rels),
    };
}

// MAP is intentionally absent (its cross-record check is a deferred follow-up); it has no relationship model.
const registry = new Map<string, RelationshipModel>([
    ["itm", ieModel("itm")],
    ["spl", ieModel("spl")],
    ["eff", ieModel("eff")],
    [
        "cre",
        ieModel(
            "cre",
            { fieldOverride: creWeaponFieldOverride, dependents: creWeaponDependents },
            spellbookCapacityDiagnostics,
        ),
    ],
]);

export function getRelationshipModel(formatId: string): RelationshipModel | undefined {
    return registry.get(formatId);
}
