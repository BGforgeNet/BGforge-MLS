import type { RelationshipModel } from "./types";

const registry = new Map<string, RelationshipModel>();

export function getRelationshipModel(formatId: string): RelationshipModel | undefined {
    return registry.get(formatId);
}
