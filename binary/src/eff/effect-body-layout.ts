/**
 * Shared EFF v2 (264-byte) effect-body layout, as reusable rows + label overrides parameterized by field-ref
 * prefix. The same body appears standalone (`eff.body.`) and embedded in a CRE whose `effStructureVersion` is
 * 1 (`cre.effects[].v2.`); both render these identical panels so an effect looks the same wherever it lives,
 * rather than one site getting curated panels and the other a generic auto-form. See the binary-editor
 * uniform-shared-layout principle. The genuinely-different 48-byte EFF v1 body has its own fragment.
 */

import type { DetailRow } from "../layout-schema-types";

/** Field ref for an EFF v2 body field under a given semantic-key prefix. */
const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The EFF v2 body panels (Effect / Dice & Save / Parameters / Resources / Classification / Caster & Projectile
 *  / Resistance), emitted for any field-ref prefix. Returns detail rows (no `list`/`raw` blocks) so the same
 *  fragment serves both as the standalone EFF variant's rows and as a master-detail list's `detailVariant`
 *  (CRE-embedded v2 effects). Signature/version magic and reserved padding are omitted (constants, not user
 *  data); the serializer rebuilds them from the model. */
export function effV2BodyRows(prefix: string): DetailRow[] {
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
                    title: "Dice & Save",
                    blocks: [
                        { kind: "fields", fields: [k("diceThrown"), k("diceSides"), k("saveBonus")] },
                        { kind: "flags", field: k("saveType"), columns: 1 },
                    ],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Parameters",
                    blocks: [
                        {
                            kind: "fields",
                            fields: [
                                k("parameter1"),
                                k("parameter2"),
                                k("parameter3"),
                                k("parameter4"),
                                k("parameter5"),
                            ],
                        },
                    ],
                },
                {
                    title: "Resources",
                    blocks: [{ kind: "fields", fields: [k("resource"), k("resource2"), k("resource3")] }],
                },
                {
                    // school/sectype/stacking/variableName are effect metadata, not resref resources.
                    title: "Classification",
                    blocks: [
                        {
                            kind: "fields",
                            fields: [k("school"), k("sectype"), k("stackingIdTobex"), k("variableName")],
                        },
                    ],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Caster & Projectile",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [
                                k("casterLevel"),
                                k("casterXCoord"),
                                k("casterYCoord"),
                                k("targetXCoord"),
                                k("targetYCoord"),
                                k("parentResourceType"),
                                k("parentResource"),
                                k("parentResourceFlags"),
                                k("projectile"),
                                k("timeApplied"),
                            ],
                        },
                    ],
                },
                {
                    // Two dispel/magic-resistance bits. `fit` keeps it content-width beside the Caster &
                    // Projectile panel rather than wrapping onto its own near-empty row.
                    title: "Resistance",
                    fit: true,
                    blocks: [{ kind: "flags", field: k("resistance"), columns: 1 }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the EFF v2 body at a given prefix - expand "Coord", fix "Id"/jargon. */
export function effV2BodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => refAt(prefix, key);
    return {
        [k("casterXCoord")]: "Caster X Coordinate",
        [k("casterYCoord")]: "Caster Y Coordinate",
        [k("targetXCoord")]: "Target X Coordinate",
        [k("targetYCoord")]: "Target Y Coordinate",
        [k("stackingIdTobex")]: "Stacking ID (ToBEx)",
    };
}
