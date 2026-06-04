import type { FlatNode, Model } from "../model";
import type { Diagnostic, NodeId } from "../types";

export interface FieldOverride {
    label?: string;
    description?: string;
    enumOptions?: Readonly<Record<string, string>>;
    presentationType?: "scalar" | "enum" | "flags";
    editable?: boolean;
}

export interface RelationshipModel {
    readonly formatId: string;
    fieldOverride(model: Model, node: FlatNode): FieldOverride | undefined;
    dependents(model: Model, editedNode: FlatNode): NodeId[];
    constraints(model: Model): Diagnostic[];
}
