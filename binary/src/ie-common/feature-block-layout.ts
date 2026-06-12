/**
 * ITM/SPL feature-block (48-byte) effect layout: the field order + label overrides for the shared
 * effect-layout builder. ITM and SPL both embed this record (`ie-common/specs/effect.ts`) in their Effects
 * list, so both render through `effectBodyRows` (at `itm.effects[].` / `spl.effects[].`).
 *
 * Fields are listed in on-disk (wire) byte order - the same order as `specs/effect.ts`, top to bottom -
 * rendering identically to the EFF v1/v2 bodies (`effectBodyRows` owns the shared panel structure). The
 * feature block is a SMALLER, DISTINCT record from the EFF v2 body: it has no caster/projectile fields and
 * carries a level range (`maxLevel`/`minLevel`, the levels the effect applies between) where the EFF v2 body
 * carries dice (`diceThrown`/`diceSides`). Those are genuinely different fields, so it passes its own ordered
 * list. Its `resistance` / `saveType` carry flag tables (`specs/effect.overrides.ts`), so they are marked
 * `{ flags }` and render as flag boxes. Parameter labels are left to the opcode relationship overlay (it
 * reinterprets parameter1/parameter2 per opcode).
 */

import { effectBodyRows, type EffectJoin, PROBABILITY_JOIN, type EffectLayoutField } from "./effect-layout";
import type { DetailRow } from "../layout-schema-types";

/** The level range, shown low-to-high as `minLevel - maxLevel`. The feature block's level range occupies the
 *  same two bytes the EFF v2 body reads as dice, so it folds into one inline cell exactly like `DICE_JOIN` -
 *  two boxes side by side - only the separator differs (a range dash, matching `PROBABILITY_JOIN`). */
const LEVEL_JOIN: EffectJoin = { label: "Level", fields: ["minLevel", "maxLevel"], separator: " - " };

/** Feature-block fields in wire byte order; `resistance` / `saveType` carry flag tables, so they render as flag
 *  boxes. */
const FEATURE_BLOCK_FIELDS: readonly EffectLayoutField[] = [
    "opcode",
    "target",
    "power",
    "parameter1",
    "parameter2",
    "timing",
    { flags: "resistance" },
    "duration",
    "probability1",
    "probability2",
    "resource",
    "maxLevel",
    "minLevel",
    { flags: "saveType" },
    "saveBonus",
    "stackingIdEx",
];

/** The feature-block rows for any field-ref prefix. The feature block has no dice (it carries a level range
 *  instead), so the probability range and the level range fold. */
export function featureBlockBodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, FEATURE_BLOCK_FIELDS, [PROBABILITY_JOIN, LEVEL_JOIN]);
}

/** Display-label overrides for the feature block at a given prefix. `maxLevel`/`minLevel` fold into the "Level"
 *  cell, but their labels still name the fields in the model/field-map (as the Coordinates axes do); the ToBEx
 *  stacking id is kept verbatim with the EFF v2 fragment's "Stacking ID (ToBEx)" so the two read identically. */
export function featureBlockBodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => `${prefix}.${key}`;
    return {
        [k("maxLevel")]: "Maximum Level",
        [k("minLevel")]: "Minimum Level",
        [k("saveBonus")]: "Save Bonus",
        [k("stackingIdEx")]: "Stacking ID (ToBEx)",
    };
}
