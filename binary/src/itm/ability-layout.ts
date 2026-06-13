/**
 * Shared ITM ability (extended-header) layout, as reusable rows + label overrides parameterized by field-ref
 * prefix. An ITM ability renders these curated panels (at `itm.abilities[].`) instead of a generic auto-form,
 * so it reads as panels consistent with the effects beside it (the effect fragments do the same). Parallel to
 * the SPL ability fragment (`../spl/ability-layout.ts`): both lead with an "Ability" panel (activation +
 * targeting), then each adds the panels its own record needs - ITM is a weapon header (damage dice, THAC0,
 * charges, projectile/melee animation) where SPL is a spell header (casting cost). The ITM "Animation" panel
 * boxes the projectile parameters + ammo flags ("Projectile") and the melee swing slots ("Melee"); SPL carries
 * only a single projectile resref, so it has no equivalent (see the binary-editor uniform-shared-layout
 * principle: same record -> one fragment; similar record -> parallel one).
 *
 * The serializer-managed feature-block pointers (`featureBlockCount`/`featureBlockIndex`) are omitted - they
 * are derived from which effects belong to the ability, not user data; the serializer rebuilds them.
 */

import type { DetailRow } from "../layout-schema-types";

const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The ITM ability panels, emitted for any field-ref prefix. The `Melee` group references the three per-slot
 *  keys (Overhand/Backhand/Thrust) the adapter emits distinctly. */
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
            ],
        },
        {
            panels: [
                {
                    title: "Damage",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 1,
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
                {
                    title: "Charges",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("maxCharges"), k("depletion")] }],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Animation",
                    stack: true,
                    blocks: [
                        // The projectile parameters and the ammo-type flags share one "Projectile" box (a
                        // group holds a flat field list - no nested boxes); column-major fill puts the three
                        // parameters in column 1 and the three ammo checkboxes in column 2.
                        {
                            kind: "group",
                            label: "Projectile",
                            columns: 2,
                            fields: [
                                k("projectileType"),
                                k("projectileAnimation"),
                                k("speed"),
                                k("isArrow"),
                                k("isBolt"),
                                k("isBullet"),
                            ],
                        },
                        {
                            kind: "group",
                            label: "Melee",
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
                    title: "Flags",
                    blocks: [{ kind: "flags", field: k("flags"), columns: 1 }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the ITM ability at a given prefix - the ammo-type booleans read as short "Arrow"
 *  / "Bolt" / "Bullet" rather than "Is Arrow" inside the "Projectile" box. */
export function itmAbilityBodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => refAt(prefix, key);
    return {
        [k("isArrow")]: "Arrow",
        [k("isBolt")]: "Bolt",
        [k("isBullet")]: "Bullet",
    };
}
