import type { RelationshipModel } from "./types";
import { ieEffectsModel } from "./ie-effects";

const registry = new Map<string, RelationshipModel>();

// IE effect formats share the same opcode-driven parameter overlay.
for (const id of ["itm", "spl", "eff", "cre"]) {
    registry.set(id, ieEffectsModel);
}

export function getRelationshipModel(formatId: string): RelationshipModel | undefined {
    return registry.get(formatId);
}
