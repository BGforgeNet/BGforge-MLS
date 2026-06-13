/**
 * Shared ITM ability (extended-header) layout, as reusable rows + label overrides parameterized by field-ref
 * prefix. An ITM ability renders these curated panels (at `itm.abilities[].`) instead of a generic auto-form,
 * so it reads as panels consistent with the effects beside it (the effect fragments do the same). Parallel to
 * the SPL ability fragment (`../spl/ability-layout.ts`): both lead with an "Ability" panel (activation +
 * targeting) and a "Projectile" panel, then each adds the panels its own record needs - ITM is a weapon header
 * (damage dice, THAC0, charges, melee/ammo animation) where SPL is a spell header (casting cost). Same titles
 * and disposition where the records align; extra panels for the fields the other record lacks (see the
 * binary-editor uniform-shared-layout principle: same record -> one fragment; similar record -> parallel one).
 *
 * The serializer-managed feature-block pointers (`featureBlockCount`/`featureBlockIndex`) are omitted - they
 * are derived from which effects belong to the ability, not user data; the serializer rebuilds them.
 */

import type { DetailRow } from "../layout-schema-types";

const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The ITM ability panels, emitted for any field-ref prefix. The `Melee Animation` group references the three
 *  per-slot keys (Overhand/Backhand/Thrust) the adapter now emits distinctly. */
export function itmAbilityBodyRows(prefix: string): DetailRow[] {
    const k = (key: string): string => refAt(prefix, key);
    return [
        {
            panels: [
                {
                    title: "Ability",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [
                                k("attackType"),
                                k("location"),
                                k("target"),
                                k("targetCount"),
                                k("range"),
                                k("useIcon"),
                                k("primaryType"),
                                k("secondaryType"),
                                k("thac0Bonus"),
                            ],
                        },
                        { kind: "flags", field: k("identification"), columns: 1 },
                    ],
                },
                {
                    title: "Damage",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [
                                k("diceThrown"),
                                k("diceSides"),
                                k("damageBonus"),
                                k("alternativeDiceThrown"),
                                k("alternativeDiceSides"),
                                k("alternativeDamageBonus"),
                                k("damageType"),
                            ],
                            // Fold each damage roll (dice + bonus) into one D&D-style "XdY+Z" cell; the
                            // launcher-ammo alternative damage gets its own "Alt. Dice" cell right after.
                            joins: [
                                {
                                    label: "Dice",
                                    fields: [k("diceThrown"), k("diceSides"), k("damageBonus")],
                                    separator: ["d", "+"],
                                },
                                {
                                    label: "Alt. Dice",
                                    fields: [
                                        k("alternativeDiceThrown"),
                                        k("alternativeDiceSides"),
                                        k("alternativeDamageBonus"),
                                    ],
                                    separator: ["d", "+"],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Projectile",
                    stack: true,
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [k("projectileType"), k("projectileAnimation"), k("speed")],
                        },
                        {
                            kind: "group",
                            label: "Ammo Type",
                            columns: 3,
                            fields: [k("isArrow"), k("isBolt"), k("isBullet")],
                        },
                        {
                            kind: "group",
                            label: "Melee Animation",
                            columns: 3,
                            fields: [
                                k("meleeAnimation.overhand"),
                                k("meleeAnimation.backhand"),
                                k("meleeAnimation.thrust"),
                            ],
                        },
                    ],
                },
                {
                    title: "Charges",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("maxCharges"), k("depletion")] }],
                },
                {
                    title: "Flags",
                    blocks: [{ kind: "flags", field: k("flags"), columns: 1 }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the ITM ability at a given prefix - drop the group-prefix the "Ammo Type" boxed
 *  legend already states, so the flag labels read short inside their box. */
export function itmAbilityBodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => refAt(prefix, key);
    return {
        [k("isArrow")]: "Arrow",
        [k("isBolt")]: "Bolt",
        [k("isBullet")]: "Bullet",
    };
}
