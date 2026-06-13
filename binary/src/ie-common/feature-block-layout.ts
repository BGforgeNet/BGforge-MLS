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

/**
 * All scalars in ONE flat 3-column grid, then the two flag bitfields grouped together at the end (so they sit
 * side by side in one row - Resistance as a single column beside the wider Save Type - rather than each claiming
 * its own band). Order is wire byte order with two sanctioned reorders for clarity (the layout schema permits
 * reordering for clarity):
 *   - `parameter1`/`parameter2` sit AFTER timing/duration rather than at their wire position (0x04/0x08). With
 *     column-major fill they would otherwise share Opcode's column, and their long opcode-relabeled labels
 *     ("Statistic Modifier", ...) floor that column's label track, padding the short "Opcode" label far from its
 *     value (the stable-columns guard rejects that). After timing/duration they land in the next column instead,
 *     so Opcode's column holds only short labels and hugs.
 *   - `resistance`/`saveType` are pulled out of their wire positions (0x0d/0x24) to the end so they group.
 */
const FEATURE_BLOCK_FIELDS: readonly EffectLayoutField[] = [
    "opcode",
    "target",
    "power",
    "timing",
    "duration",
    "parameter1",
    "parameter2",
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

/** The feature-block rows for any field-ref prefix. All scalars pack into ONE flat 3-column grid (column-major,
 *  reading down each column) so the detail fills the width as one area; the Resistance and Save Type flag boxes
 *  then sit side by side in one row at the end (Resistance single-column beside the wider Save Type). Only the
 *  probability range folds; the 0x1c/0x20 pair (maxLevel/minLevel) renders as two standalone fields,
 *  opcode-relabeled Level<->Dice at runtime. */
export function featureBlockBodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, FEATURE_BLOCK_FIELDS, [PROBABILITY_JOIN], 3);
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
