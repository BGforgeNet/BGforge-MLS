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
    /** Follow-on edits implied by an edit to `editedNode` (which already carries its new value): e.g. clearing a
     *  sibling inventory slot that held the just-reassigned item, so a `uniqueRef` reference stays unique. The
     *  edit pipeline applies these in the same undo step. Empty when the format has no cascading references. */
    cascade(model: Model, editedNode: FlatNode): { nodeId: NodeId; value: number }[];
}
