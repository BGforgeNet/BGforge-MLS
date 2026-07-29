import type { ExternalRef } from "@bgforge/binary";
import type { FlatNode, Model } from "../model";
import type { Diagnostic, NodeId } from "../types";

export interface FieldOverride {
    label?: string;
    description?: string;
    enumOptions?: Readonly<Record<string, string>>;
    presentationType?: "scalar" | "enum" | "flags";
    editable?: boolean;
    /** Cross-record jump target: this field references another record, `targetNodeId` is that record's entry
     *  node, `sectionKey` is its list section (so the view can switch tabs), and `label` describes it. Copied
     *  onto the Row so the view can render a click-to-navigate affordance. */
    link?: { targetNodeId: NodeId; sectionKey: string; label: string };
    /** External reference computed from a SIBLING field's value, where the spec cannot declare a static one -
     *  an effect's IDS Entry, whose table its IDS File parameter names. Overwrites any spec-declared `ref` on
     *  the row, so the host's existing resolution handles it with no separate path. */
    ref?: ExternalRef;
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
