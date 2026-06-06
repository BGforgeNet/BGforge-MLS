/**
 * PRO declarative layout. Attached to the PRO adapter so the editor renders PRO on a single dense page
 * via the generic layout renderer instead of the legacy depth-0-groups-as-tabs path. The active variant
 * is chosen by the parse result's `variantId` (see `proVariantId` in `index.ts`).
 *
 * Critter is the worked example (the approved mockup): a Header panel (fields + the 11 critter flags as
 * two checkbox columns), a Demographics panel, a Final panel, a Stats matrix (Primary / Secondary / Dmg
 * Threshold / Dmg Resist, each Base|Bonus), and a 4-column Skills grid. Field refs are the semantic keys
 * `toSemanticFieldKey("pro", sourceSegments)` produces for the flat "Critter" group (verified against the
 * model). Other object/sub types have no variant yet and fall back to the tabs path (follow-up effort).
 */

import { formatLayoutSchema, type FormatLayout, type LayoutRow } from "../layout-schema-types";

/** Semantic key for a flat critter field. */
const k = (key: string): string => `pro.critter.${key}`;

/** A matrix row whose Base/Bonus cells are `<key>` and `<key>Bonus`. */
function baseBonus(label: string, key: string): { label: string; cells: Record<string, string> } {
    return { label, cells: { base: k(key), bonus: k(`${key}Bonus`) } };
}

const critterRows: LayoutRow[] = [
    // Top row: Header (fields + two flag columns) | Demographics | Final - clumped left.
    {
        panels: [
            {
                title: "Header",
                blocks: [
                    {
                        kind: "fields",
                        fields: [k("scriptType"), k("scriptId"), k("headFrmId"), k("aiPacket"), k("teamNumber")],
                    },
                    { kind: "flags", field: k("critterFlags"), columns: 2 },
                ],
            },
            { title: "Demographics", blocks: [{ kind: "fields", fields: [k("age"), k("gender")] }] },
            {
                title: "Final",
                blocks: [
                    { kind: "fields", fields: [k("bodyType"), k("experienceValue"), k("killType"), k("damageType")] },
                ],
            },
        ],
    },
    // Stats: four side-by-side Base|Bonus matrices.
    {
        panels: [
            {
                title: "Stats",
                blocks: [
                    {
                        kind: "matrix",
                        columnWidthPx: 200,
                        valueColumns: [
                            { key: "base", label: "Base" },
                            { key: "bonus", label: "Bonus" },
                        ],
                        groups: [
                            {
                                label: "Primary",
                                rows: [
                                    baseBonus("Strength", "strength"),
                                    baseBonus("Perception", "perception"),
                                    baseBonus("Endurance", "endurance"),
                                    baseBonus("Charisma", "charisma"),
                                    baseBonus("Intelligence", "intelligence"),
                                    baseBonus("Agility", "agility"),
                                    baseBonus("Luck", "luck"),
                                ],
                            },
                            {
                                label: "Secondary",
                                rows: [
                                    baseBonus("Hit Points", "hitPoints"),
                                    baseBonus("Action Pts", "actionPoints"),
                                    baseBonus("Armor Class", "armorClass"),
                                    baseBonus("Unarmed Dmg", "unarmedDamage"),
                                    baseBonus("Melee Dmg", "meleeDamage"),
                                    baseBonus("Carry Weight", "carryWeight"),
                                    baseBonus("Sequence", "sequence"),
                                    baseBonus("Healing Rate", "healingRate"),
                                    baseBonus("Critical %", "criticalChance"),
                                    baseBonus("Better Crit", "betterCriticals"),
                                ],
                            },
                            {
                                label: "Dmg Threshold",
                                rows: [
                                    baseBonus("Normal", "dtNormal"),
                                    baseBonus("Laser", "dtLaser"),
                                    baseBonus("Fire", "dtFire"),
                                    baseBonus("Plasma", "dtPlasma"),
                                    baseBonus("Electrical", "dtElectrical"),
                                    baseBonus("EMP", "dtEmp"),
                                    baseBonus("Explosive", "dtExplosive"),
                                ],
                            },
                            {
                                label: "Dmg Resist",
                                rows: [
                                    baseBonus("Normal", "drNormal"),
                                    baseBonus("Laser", "drLaser"),
                                    baseBonus("Fire", "drFire"),
                                    baseBonus("Plasma", "drPlasma"),
                                    baseBonus("Electrical", "drElectrical"),
                                    baseBonus("EMP", "drEmp"),
                                    baseBonus("Explosive", "drExplosive"),
                                    baseBonus("Radiation", "drRadiation"),
                                    baseBonus("Poison", "drPoison"),
                                ],
                            },
                        ],
                    },
                ],
            },
        ],
    },
    // Skills: 4-column grid.
    {
        panels: [
            {
                title: "Skills",
                blocks: [
                    {
                        kind: "grid",
                        columns: 4,
                        items: [
                            k("smallGuns"),
                            k("bigGuns"),
                            k("energyWeapons"),
                            k("unarmed"),
                            k("melee"),
                            k("throwing"),
                            k("firstAid"),
                            k("doctor"),
                            k("sneak"),
                            k("lockpick"),
                            k("steal"),
                            k("traps"),
                            k("science"),
                            k("repair"),
                            k("speech"),
                            k("barter"),
                            k("gambling"),
                            k("outdoorsman"),
                        ],
                    },
                ],
            },
        ],
    },
];

export const proLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "pro",
    maxContentWidthPx: 920,
    variants: {
        critter: { rows: critterRows },
    },
});
