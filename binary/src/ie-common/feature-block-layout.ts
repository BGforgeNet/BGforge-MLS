/**
 * ITM/SPL feature-block (48-byte) effect layout: the field order + label overrides for the shared
 * effect-layout builder. ITM and SPL both embed this record (`ie-common/specs/effect.ts`) in their Effects
 * list, so both render through `effectBodyRows` (at `itm.effects[].` / `spl.effects[].`).
 *
 * Fields are listed in on-disk (wire) byte order - the same order as `specs/effect.ts`, top to bottom -
 * rendering identically to the EFF v1/v2 bodies (`effectBodyRows` owns the shared panel structure). The
 * feature block is a SMALLER, DISTINCT record from the EFF v2 body (no caster/projectile fields). Its 0x1c/0x20
 * dword pair is the SAME dual-purpose field the EFF body has - a Maximum/Minimum Level range for most opcodes,
 * Dice Thrown/Dice Sides for a few (12/17/18/331/333, 218 when param2=1) - just spec-named `maxLevel`/`minLevel`
 * here and `diceThrown`/`diceSides` in the EFF body. It renders as two standalone fields whose default label is
 * the level reading; the opcode overlay (binary-editor `ie-effects`) flips them to the dice reading per opcode,
 * exactly as it relabels parameter1/parameter2. Its `resistance` / `saveType` carry flag tables
 * (`specs/effect.overrides.ts`), so they are marked `{ flags }` and render as flag boxes.
 */

import { effectBodyRows, PROBABILITY_JOIN, type EffectLayoutField } from "./effect-layout";
import type { DetailRow } from "../layout-schema-types";

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

/** The feature-block rows for any field-ref prefix. Only the probability range folds; the 0x1c/0x20 pair
 *  (maxLevel/minLevel) renders as two standalone fields, opcode-relabeled Level<->Dice at runtime. */
export function featureBlockBodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, FEATURE_BLOCK_FIELDS, [PROBABILITY_JOIN]);
}

/** Display-label overrides for the feature block at a given prefix. `maxLevel`/`minLevel` carry the default
 *  level reading of the dual-purpose 0x1c/0x20 pair (the opcode overlay flips them to Dice Thrown/Dice Sides for
 *  dice opcodes); the ToBEx stacking id is kept verbatim with the EFF v2 fragment's "Stacking ID (ToBEx)" so the
 *  two read identically. */
export function featureBlockBodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => `${prefix}.${key}`;
    return {
        [k("maxLevel")]: "Maximum Level",
        [k("minLevel")]: "Minimum Level",
        [k("saveBonus")]: "Save Bonus",
        [k("stackingIdEx")]: "Stacking ID (ToBEx)",
    };
}
