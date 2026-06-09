import { formatAdapterRegistry } from "@bgforge/binary";
import type { Model } from "../model";
import type { RelationshipModel } from "./types";
import { ieEffectsFieldOverride, ieEffectsDependents, ieEffectsProbabilityConstraint } from "./ie-effects";
import { crossRefDiagnostics } from "./cross-record";

/** Build an IE relationship model: the shared opcode/parameter field overlay + probability check, plus the
 *  format's declarative cross-record relationships (resolved from its `@bgforge/binary` adapter). */
function ieModel(formatId: string): RelationshipModel {
    return {
        formatId,
        fieldOverride: ieEffectsFieldOverride,
        dependents: ieEffectsDependents,
        constraints: (model: Model) => [
            ...ieEffectsProbabilityConstraint(model),
            ...crossRefDiagnostics(model, formatAdapterRegistry.get(formatId)?.crossRefRelationships ?? []),
        ],
    };
}

// MAP is intentionally absent (its cross-record check is a deferred follow-up); it has no relationship model.
const registry = new Map<string, RelationshipModel>([
    ["itm", ieModel("itm")],
    ["spl", ieModel("spl")],
    ["eff", ieModel("eff")],
    ["cre", ieModel("cre")],
]);

export function getRelationshipModel(formatId: string): RelationshipModel | undefined {
    return registry.get(formatId);
}
