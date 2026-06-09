/**
 * Shared ITM/SPL feature-block (48-byte) effect layout, as reusable rows + label overrides parameterized by
 * field-ref prefix. ITM and SPL both embed this record (`ie-common/specs/effect.ts`) in their Effects list, so
 * both render these identical panels (at `itm.effects[].` / `spl.effects[].`) instead of a generic auto-form.
 *
 * The panel structure is deliberately PARALLEL to the EFF v2 body fragment (`../eff/effect-body-layout.ts`) -
 * same titles and disposition (Effect / Save / Parameters / Resources / Classification / Resistance), same
 * controls for the same jobs - so an effect reads the same across formats even though the feature block is a
 * SMALLER, DISTINCT record: it has no caster/projectile block and carries a level range (`maxLevel`/`minLevel`,
 * the levels the effect applies between) where the EFF v2 body carries dice (`diceThrown`/`diceSides`). Those
 * are genuinely different fields, so this is a sibling fragment, not the same fragment reused (see the
 * binary-editor uniform-shared-layout principle: same record -> one fragment; similar record -> parallel one).
 */

import type { DetailRow } from "../layout-schema-types";

const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The feature-block panels, emitted for any field-ref prefix. Parameter labels are left to the opcode
 *  relationship overlay (it reinterprets parameter1/parameter2 per opcode, same as the EFF v2 fragment). */
export function featureBlockBodyRows(prefix: string): DetailRow[] {
    const k = (key: string): string => refAt(prefix, key);
    return [
        {
            panels: [
                {
                    title: "Effect",
                    blocks: [
                        {
                            kind: "fields",
                            fields: [
                                k("opcode"),
                                k("target"),
                                k("power"),
                                k("timing"),
                                k("duration"),
                                k("probability1"),
                                k("probability2"),
                            ],
                        },
                    ],
                },
                {
                    // Mirrors the EFF v2 "Dice & Save" panel; the feature block gates the effect by a level range
                    // (min/max level the target must be) rather than carrying dice, but the save controls match.
                    title: "Level & Save",
                    blocks: [
                        { kind: "fields", fields: [k("maxLevel"), k("minLevel"), k("saveBonus")] },
                        { kind: "flags", field: k("saveType"), columns: 1 },
                    ],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Parameters",
                    blocks: [{ kind: "fields", fields: [k("parameter1"), k("parameter2")] }],
                },
                {
                    title: "Resources",
                    blocks: [{ kind: "fields", fields: [k("resource")] }],
                },
                {
                    title: "Classification",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("stackingIdEx")] }],
                },
            ],
        },
        {
            // Two dispel/magic-resistance bits; `fit` keeps it content-width rather than spanning the row.
            panels: [
                {
                    title: "Resistance",
                    fit: true,
                    blocks: [{ kind: "flags", field: k("resistance"), columns: 1 }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the feature block at a given prefix - expand the level range and the ToBEx
 *  stacking id (kept verbatim with the EFF v2 fragment's "Stacking ID (ToBEx)" so the two read identically). */
export function featureBlockBodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => refAt(prefix, key);
    return {
        [k("maxLevel")]: "Maximum Level",
        [k("minLevel")]: "Minimum Level",
        [k("saveBonus")]: "Save Bonus",
        [k("stackingIdEx")]: "Stacking ID (ToBEx)",
    };
}
