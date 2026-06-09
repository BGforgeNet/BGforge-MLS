import type { Model } from "../model";
import type { Diagnostic } from "../types";
import type { RelationshipModel } from "./types";
import { ieEffectsFieldOverride, ieEffectsDependents, ieEffectsProbabilityConstraint } from "./ie-effects";
import {
    creMeminfoRefConstraint,
    creItemSlotRefConstraint,
    creOrphanItemsConstraint,
    abilityEffectRefConstraint,
    orphanEffectsConstraint,
} from "./cross-record";

type ConstraintFn = (model: Model) => Diagnostic[];

/** Build an IE relationship model: the shared opcode/parameter field overlay + probability check, plus any
 *  format-specific cross-record constraints. */
function ieModel(formatId: string, extra: ConstraintFn[]): RelationshipModel {
    return {
        formatId,
        fieldOverride: ieEffectsFieldOverride,
        dependents: ieEffectsDependents,
        constraints: (model) => [...ieEffectsProbabilityConstraint(model), ...extra.flatMap((fn) => fn(model))],
    };
}

// MAP is intentionally absent (its cross-record check is a deferred follow-up); it has no relationship model.
const registry = new Map<string, RelationshipModel>([
    ["itm", ieModel("itm", [abilityEffectRefConstraint, orphanEffectsConstraint])],
    ["spl", ieModel("spl", [abilityEffectRefConstraint, orphanEffectsConstraint])],
    ["eff", ieModel("eff", [])],
    ["cre", ieModel("cre", [creMeminfoRefConstraint, creItemSlotRefConstraint, creOrphanItemsConstraint])],
]);

export function getRelationshipModel(formatId: string): RelationshipModel | undefined {
    return registry.get(formatId);
}
