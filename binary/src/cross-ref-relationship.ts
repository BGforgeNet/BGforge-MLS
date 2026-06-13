/**
 * Declarative cross-record relationship descriptors.
 *
 * The single source of truth for how a format's display-tree groups reference one another by index.
 * A format that has structural back-references (CRE item slots -> items, ITM/SPL abilities -> effects,
 * CRE memorization info -> memorized spells) declares them here, on its adapter. The edit-time relink
 * (entity-ops) already owns this knowledge; exposing it as data lets the editor's advisory diagnostics
 * derive from the SAME definition instead of re-encoding "which field references what" a second time
 * (which is how the two drifted: the relink exempted CRE's trailing selected-weapon slots while the
 * diagnostic did not, flagging fist-fighters as referencing item #1000).
 *
 * Field keys carry the canonical field name; the diagnostic layer matches them against the humanized
 * display label via a normalize-on-both-sides key (`featureBlockIndex` and "Feature Block Index" both
 * reduce to `featureblockindex`), so the same `IeEffectRangeFields` the relink binds can be reused here.
 */

import type { IeEffectRangeFields } from "./ie-common/effect-partition";

/**
 * A group whose leading child fields each hold an index into a target list (e.g. CRE "Item Slots" ->
 * "Items"). `refFieldCount` bounds how many leading fields are references; any trailing fields (CRE's
 * selected-weapon slot index and ability index) are NOT item indices and stay unchecked. Omitted =>
 * every field in the group is a reference.
 */
export interface IndexRefRelationship {
    readonly kind: "index";
    readonly refGroup: string; // display label of the referring group
    readonly targetGroup: string; // display label of the referenced list
    readonly refNoun: string; // singular noun for messages ("item")
    readonly refFieldCount?: number;
    /** Emit an info note for targets referenced by no in-range field. */
    readonly orphanInfo?: boolean;
    /** Each in-range field must reference a DISTINCT target (a CRE item table entry belongs in one inventory
     *  slot). Drives two behaviors: an info note when a target is referenced by more than one slot (it can only
     *  arise from a hand-authored / external CRE, never the editor), and an edit-time cascade that clears any
     *  sibling slot already holding the just-assigned target so the editor never creates a duplicate. */
    readonly uniqueRef?: boolean;
    /** Canonical field key of a target entry that labels it in a reference dropdown (e.g. the item ResRef).
     *  When set, the editor renders each in-range referring field as a NONE/-1 + indexed-target dropdown
     *  instead of a raw number; omitted leaves the reference a plain numeric field. */
    readonly targetLabelField?: string;
}

/**
 * Owner groups (and an optional single header group) carry a [start, start+count) slice into a target
 * list (ITM/SPL abilities + equipping/casting header -> "Effects"; CRE memorization info -> "Memorized
 * Spells"). `fields` is the same range-field binding the relink uses; the header range is read from its
 * `headerStart`/`headerCount` members and is only collected when `headerGroup` is set.
 */
export interface SliceRefRelationship {
    readonly kind: "slice";
    readonly ownerGroup: string;
    readonly headerGroup?: string; // single-instance owner with its own range fields
    readonly targetGroup: string;
    readonly sliceNoun: string; // noun for messages ("Effect", "Memorized-spell")
    readonly fields: IeEffectRangeFields;
    /** Emit an info note for targets covered by no slice. */
    readonly orphanInfo?: boolean;
    /** Warn when two slices cover a common target (an entry claimed by more than one owner). Opt-in because
     *  only partitioning slices - CRE memorization info, ITM/SPL ability effects - expect disjoint coverage. */
    readonly overlapWarn?: boolean;
    /** Noun naming an owning slice in the orphan/overlap messages ("covered by no <X>", "claimed by more than
     *  one <X>"). Defaults to the ITM/SPL "ability or equipping/casting range"; CRE overrides it. */
    readonly coverageNoun?: string;
}

export type CrossRefRelationship = IndexRefRelationship | SliceRefRelationship;
