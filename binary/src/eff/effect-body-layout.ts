/**
 * EFF v2 (264-byte) effect-body layout: the field order + label overrides for the shared effect-layout builder.
 * The same body appears standalone (`eff.body.`) and embedded in a CRE whose `effStructureVersion` is 1
 * (`cre.effects[].v2.`); both render through `effectBodyRows` so an effect looks the same wherever it lives.
 *
 * Fields are listed in on-disk (wire) byte order - the same order as `specs/body.ts`, top to bottom. The two
 * bitfields (`saveType`, `resistance`) are marked `{ flags }` so they render as flag boxes; `effectBodyRows`
 * owns the panel structure. Signature/version magic and reserved padding (`unused*`) are omitted (constants,
 * not user data - the serializer rebuilds them from the model).
 */

import {
    DICE_JOIN,
    effectBodyRows,
    type EffectGroup,
    type EffectLayoutField,
    PROBABILITY_JOIN,
} from "../ie-common/effect-layout";
import type { DetailRow } from "../layout-schema-types";

// The two caster/target location points (EFF v2 only - neither the EFF v1 body nor the feature block carries
// coordinates) sit in a single labelled "Coordinates" subgroup box, each point folding its X/Y axes into one
// `x, y` cell. The per-axis label overrides (below) still name the fields in the model/field-map; the folded
// cell shows the point's join label.
const COORDINATES_GROUP: EffectGroup = {
    label: "Coordinates",
    fields: ["casterXCoord", "casterYCoord", "targetXCoord", "targetYCoord"],
    columns: 1,
    joins: [
        { label: "Caster", fields: ["casterXCoord", "casterYCoord"], separator: ", " },
        { label: "Target", fields: ["targetXCoord", "targetYCoord"], separator: ", " },
    ],
};

// Related trailing fields grouped into single-column subgroup boxes (consistent with Coordinates).
const PARAMETERS_GROUP: EffectGroup = {
    label: "Parameters",
    fields: ["parameter3", "parameter4", "parameter5"],
    columns: 1,
};
const RESOURCES_GROUP: EffectGroup = { label: "Resources", fields: ["resource2", "resource3"], columns: 1 };
// The box legend supplies the "Parent Resource" context, so its fields drop that prefix (see label overrides);
// the resref (`parentResource`, the main field) leads, then its type and flags.
const PARENT_RESOURCE_GROUP: EffectGroup = {
    label: "Parent Resource",
    fields: ["parentResource", "parentResourceType", "parentResourceFlags"],
    columns: 1,
};
// `school` and `sectype` (effect classification metadata) are non-adjacent in byte order but combine into one
// "Classification" box, placed at `school`'s position.
const CLASSIFICATION_GROUP: EffectGroup = { label: "Classification", fields: ["school", "sectype"], columns: 1 };

/** EFF v2 body fields in wire byte order; `saveType` / `resistance` carry flag tables, so they render as flag
 *  boxes. */
const EFF_V2_FIELDS: readonly EffectLayoutField[] = [
    "opcode",
    "target",
    "power",
    "parameter1",
    "parameter2",
    "timing",
    "duration",
    "probability1",
    "probability2",
    "resource",
    "diceThrown",
    "diceSides",
    { flags: "saveType" },
    "saveBonus",
    "stackingIdTobex",
    { group: CLASSIFICATION_GROUP },
    { flags: "resistance", columns: 1 },
    { group: PARAMETERS_GROUP },
    "timeApplied",
    { group: RESOURCES_GROUP },
    { group: COORDINATES_GROUP },
    { group: PARENT_RESOURCE_GROUP },
    "projectile",
    "variableName",
    "casterLevel",
];

/** The EFF v2 body rows for any field-ref prefix (standalone `.eff` variant rows or a CRE master-detail
 *  `detailVariant`). */
export function effV2BodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, EFF_V2_FIELDS, [PROBABILITY_JOIN, DICE_JOIN]);
}

/** Display-label overrides for the EFF v2 body at a given prefix - expand "Coord", fix "Id"/jargon, and (for
 *  fields that live inside a subgroup box whose legend already supplies the context) drop the redundant prefix
 *  and renumber. */
export function effV2BodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => `${prefix}.${key}`;
    return {
        [k("casterXCoord")]: "Caster X Coordinate",
        [k("casterYCoord")]: "Caster Y Coordinate",
        [k("targetXCoord")]: "Target X Coordinate",
        [k("targetYCoord")]: "Target Y Coordinate",
        [k("stackingIdTobex")]: "Stacking ID (ToBEx)",
        // `sectype` humanizes to the unclear "Sectype"; it is the secondary type (msectype.2da).
        [k("sectype")]: "Secondary Type",
        // Inside the "Parameters" box: abbreviate "Parameter" -> "Param", keep the real field numbers.
        [k("parameter3")]: "Param 3",
        [k("parameter4")]: "Param 4",
        [k("parameter5")]: "Param 5",
        // Inside the "Parent Resource" box: drop the prefix; the resref is the main field.
        [k("parentResource")]: "ResRef",
        [k("parentResourceType")]: "Type",
        [k("parentResourceFlags")]: "Flags",
    };
}
