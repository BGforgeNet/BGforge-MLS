/**
 * EFF v2 (264-byte) effect-body layout: the field order + label overrides for the shared effect-layout builder.
 * The same body appears standalone (`eff.body.`) and embedded in a CRE whose `effStructureVersion` is 1
 * (`cre.effects[].v2.`); both render through `effectBodyRows` so an effect looks the same wherever it lives.
 *
 * Fields are listed in on-disk (wire) byte order - the same order as `specs/body.ts`, top to bottom - with a
 * few sanctioned reorders for clarity (the layout schema permits reordering for clarity): `resistance` /
 * `saveType` lead the trailing box run as a side-by-side flag pair (matching the v1 feature block), and
 * `timeApplied` is pulled to the end so it reads with the other trailing per-effect metadata. The two
 * bitfields (`saveType`, `resistance`) are marked `{ flags }` so they render as flag boxes; `effectBodyRows`
 * owns the panel structure. Signature/version magic and reserved padding (`unused*`) are omitted (constants,
 * not user data - the serializer rebuilds them from the model).
 */

import { effectBodyRows, type EffectGroup, type EffectLayoutField, PROBABILITY_JOIN } from "../ie-common/effect-layout";
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
// the resref (`parentResource`, the main field) leads, then its type, then its flags - rendered as a flag
// table inside the same legend box (the field carries a flag table; see specs/body.overrides.ts).
const PARENT_RESOURCE_GROUP: EffectGroup = {
    label: "Parent Resource",
    fields: ["parentResource", "parentResourceType", { flags: "parentResourceFlags" }],
    columns: 1,
};
// `school` and `sectype` (effect classification metadata) are non-adjacent in byte order but combine into one
// "Classification" box, placed at `school`'s position.
const CLASSIFICATION_GROUP: EffectGroup = { label: "Classification", fields: ["school", "sectype"], columns: 1 };
// `saveBonus` and `stackingIdTobex` are adjacent in byte order; box them as a single-column "Save Info" pair
// (consistent with the other trailing subgroup boxes) so they read as a stacked pair rather than two loose
// plain fields, and so the trailing run is purely boxes that pack side by side.
const SAVE_INFO_GROUP: EffectGroup = { label: "Save Info", fields: ["saveBonus", "stackingIdTobex"], columns: 1 };

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
    // Resistance (single column) beside the wider Save Type, side by side in one row - the same treatment as the
    // v1 feature block (FEATURE_BLOCK_FIELDS). Consecutive flag/group boxes pack into one wrapping row, so the
    // Save Info, Classification, Coordinates, Resources, Parameters and Parent Resource boxes that follow all
    // share that wrapping row too.
    { flags: "resistance", columns: 1 },
    { flags: "saveType" },
    { group: SAVE_INFO_GROUP },
    { group: CLASSIFICATION_GROUP },
    { group: COORDINATES_GROUP },
    { group: RESOURCES_GROUP },
    { group: PARAMETERS_GROUP },
    { group: PARENT_RESOURCE_GROUP },
    // Trailing plain run (a fields block breaks the box wrapping row above). `timeApplied` moves here, to the end,
    // so it reads with the other trailing per-effect metadata rather than mid-list.
    "projectile",
    "variableName",
    "casterLevel",
    "timeApplied",
];

/** The EFF v2 body rows for any field-ref prefix (standalone `.eff` variant rows or a CRE master-detail
 *  `detailVariant`). */
export function effV2BodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, EFF_V2_FIELDS, [PROBABILITY_JOIN]);
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
        // The 0x1c/0x20 pair is spec-named diceThrown/diceSides, but most opcodes read it as a Maximum/Minimum
        // Level range; that is the default label. The opcode overlay (binary-editor ie-effects) flips it to
        // "Dice Thrown"/"Dice Sides" for the dice opcodes (12/17/18/331/333, 218 when param2=1).
        [k("diceThrown")]: "Maximum Level",
        [k("diceSides")]: "Minimum Level",
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
