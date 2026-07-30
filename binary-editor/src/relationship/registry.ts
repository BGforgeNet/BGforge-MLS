import { formatAdapterRegistry } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { Diagnostic, NodeId } from "../types";
import type { FieldOverride, RelationshipModel } from "./types";
import { ieEffectsFieldOverride, ieEffectsDependents, ieEffectsProbabilityConstraint } from "./ie-effects";
import { crossRefDiagnostics, crossRefDependents, crossRefFieldOverride, crossRefCascade } from "./cross-record";
import { creWeaponFieldOverride, creWeaponDependents } from "./cre-weapons";
import { mapLinkFieldOverride } from "./map-links";
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
    engine: string | undefined,
    extra?: ExtraOverlay,
    extraConstraints?: (model: Model) => Diagnostic[],
): RelationshipModel {
    const rels = formatAdapterRegistry.get(formatId)?.crossRefRelationships ?? [];
    const hasIndexDropdown = rels.some((r) => r.kind === "index" && r.targetLabelField !== undefined);
    const effectsOverride = ieEffectsFieldOverride(engine);
    const effectsDependents = ieEffectsDependents(engine);
    const baseOverride = hasIndexDropdown
        ? (model: Model, node: FlatNode) => crossRefFieldOverride(model, node, rels) ?? effectsOverride(model, node)
        : effectsOverride;
    const baseDependents = hasIndexDropdown
        ? (model: Model, node: FlatNode) => [
              ...crossRefDependents(model, node, rels),
              ...effectsDependents(model, node),
          ]
        : effectsDependents;
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

// MAP has no IE-style effect/index relationships; its model exists only to overlay cross-record jump links
// (script Owner ID -> object, object SID -> script). The consistency-diagnostic check remains a follow-up.
const mapModel: RelationshipModel = {
    formatId: "map",
    fieldOverride: mapLinkFieldOverride,
    dependents: () => [],
    constraints: () => [],
    cascade: () => [],
};

function buildModelFor(formatId: string, engine: string | undefined): RelationshipModel | undefined {
    switch (formatId) {
        case "map":
            return mapModel;
        case "itm":
        case "spl":
        case "eff":
            return ieModel(formatId, engine);
        case "cre":
            return ieModel(
                formatId,
                engine,
                { fieldOverride: creWeaponFieldOverride, dependents: creWeaponDependents },
                spellbookCapacityDiagnostics,
            );
        default:
            return undefined;
    }
}

// One model per (format, engine). Memoized rather than rebuilt per session, since a model is a closure over
// static tables - and a session holds its instance for its whole life, which is what keeps the engine from
// being lost when a structure op or JSON load rebuilds the parse Model.
const registry = new Map<string, RelationshipModel | undefined>();

/**
 * The overlay for a format, reading opcodes the way `engine` does. An omitted engine - a record opened off
 * disk rather than out of a game - takes the preferred (BG(2)EE) reading.
 */
export function getRelationshipModel(formatId: string, engine?: string): RelationshipModel | undefined {
    const key = `${formatId}|${engine ?? ""}`;
    if (!registry.has(key)) registry.set(key, buildModelFor(formatId, engine));
    return registry.get(key);
}
