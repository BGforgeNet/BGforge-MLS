/**
 * ITM/SPL feature-block (48-byte) effect layout: the field order + label overrides for the shared
 * effect-layout builder. ITM/SPL embed this record (`ie-common/specs/effect.ts`) in their Effects list, and a
 * CRE's effStructureVersion-0 effects ARE this record (IESDP documents them as one), so all three render
 * through `effectBodyRows` (at `itm.effects[].` / `spl.effects[].` / `cre.effects[].v2.`).
 *
 * The scalars stay in wire byte order and pack into one tight 3-column main run; the two flag bitfields
 * (`resistance` / `saveType`) are pulled out of their wire positions and grouped side by side at the end
 * (`featureBlockBodyRows`). The feature block is a SMALLER, DISTINCT record from the EFF v2 body (no
 * caster/projectile fields). Its 0x1c/0x20
 * dword pair is the SAME dual-purpose field the EFF body has - a Maximum/Minimum Level range for most opcodes,
 * Dice Thrown/Dice Sides for a few (12/17/18/331/333, 218 when param2=1) - just spec-named `maxLevel`/`minLevel`
 * here and `diceThrown`/`diceSides` in the EFF body. It renders as two standalone fields whose default label is
 * the level reading; the opcode overlay (binary-editor `ie-effects`) flips them to the dice reading per opcode,
 * exactly as it relabels parameter1/parameter2. Its `resistance` / `saveType` carry flag tables
 * (`specs/effect.overrides.ts`), so they are marked `{ flags }` and render as flag boxes.
 */

import { effectBodyRows, PROBABILITY_JOIN, type EffectLayoutField } from "./effect-layout";
import type { DetailRow } from "../layout-schema-types";

// The identity fields (opcode + its target/power) lead in one 3-column row, kept SEPARATE from the parameter
// grid below: opcode's searchable combobox gets full width and the three short labels hug their values, none
// padded by the reserved parameter-label column they would otherwise share. Wire byte order (0x00, 0x02, 0x03).
const FEATURE_BLOCK_LEAD_FIELDS: readonly EffectLayoutField[] = ["opcode", "target", "power"];

/** The parameter/value scalars (wire byte order from 0x04) in one tight 3-column main run; `resistance` /
 *  `saveType` (the two flag bitfields) are pulled out of their wire positions (0x0d, 0x24) and grouped at the
 *  END so they sit side by side in one row - Resistance as a single column beside the wider Save Type - instead
 *  of splitting the scalars into three runs. A sanctioned reorder for clarity (scalars keep wire order). */
const FEATURE_BLOCK_GRID_FIELDS: readonly EffectLayoutField[] = [
    "parameter1",
    "parameter2",
    "timing",
    "duration",
    "probability1",
    "probability2",
    "resource",
    "maxLevel",
    "minLevel",
    "saveBonus",
    "stackingIdEx",
    { flags: "resistance", columns: 1 },
    { flags: "saveType" },
];

/** The feature-block rows for any field-ref prefix. An identity lead row (Opcode / Target / Power, 3 columns,
 *  reserve-free so the labels hug and the searchable opcode combobox gets full width), then the parameter/value
 *  scalars in one tight 3-column main run (wire byte order down each column) so the detail fills the width, then
 *  the Resistance and Save Type flag boxes side by side in one row (Resistance single-column beside Save Type).
 *  Only the probability range folds; the 0x1c/0x20 pair (maxLevel/minLevel) renders as two standalone fields,
 *  opcode-relabeled Level<->Dice at runtime. */
export function featureBlockBodyRows(prefix: string): DetailRow[] {
    return [
        ...effectBodyRows(prefix, FEATURE_BLOCK_LEAD_FIELDS, [], 3),
        ...effectBodyRows(prefix, FEATURE_BLOCK_GRID_FIELDS, [PROBABILITY_JOIN], 3),
    ];
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
