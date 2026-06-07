/**
 * PRO declarative layout. Attached to the PRO adapter so the editor renders PRO on a single dense page
 * via the generic layout renderer instead of the legacy depth-0-groups-as-tabs path. The active variant
 * is chosen by the parse result's `variantId` (see `proVariantId` in `index.ts`).
 *
 * Every PRO object/sub type has a variant: critter (the worked mockup), the seven item subtypes
 * (weapon/armor/ammo/drug/misc/key/container), the six scenery subtypes (door/stairs/elevator/ladderTop/
 * ladderBottom/generic), and wall/tile/misc. With all variants present the parser never falls back to the
 * legacy tabs path, which lets Phase 7 retire it.
 *
 * Field refs are the semantic keys `toSemanticFieldKey("pro", sourceSegments)` produces. The critter parser
 * flattens to one "Critter" group, so its keys are `pro.critter.<field>`; every other type keys its fields
 * flat as `pro.<field>` (the Header / Item Properties / Scenery Properties / subtype-stats groups all map to
 * the bare `pro.` namespace), with sub-records as `pro.<group>.<field>` (e.g. `pro.damageResistance.normal`).
 * All verified against the model via real proto fixtures of each subtype.
 */

import { formatLayoutSchema, type FormatLayout, type LayoutPanel, type LayoutRow } from "../layout-schema-types";

/** Semantic key for a flat critter field. */
const k = (key: string): string => `pro.critter.${key}`;
/** Semantic key for a non-critter PRO field, by its full group-namespaced suffix (e.g. `header.objectType`,
 *  `armorStats.damageResistance.normal`). The model namespaces every field by its parse group. */
const p = (key: string): string => `pro.${key}`;

/** The PRO common header, shared by every non-critter variant: identity/art fields + the object flags. */
const headerPanel: LayoutPanel = {
    title: "Header",
    blocks: [
        {
            kind: "fields",
            fields: [
                p("header.objectType"),
                p("header.objectId"),
                p("header.textId"),
                p("header.frmType"),
                p("header.frmId"),
                p("header.lightRadius"),
                p("header.lightIntensity"),
            ],
        },
        { kind: "flags", field: p("header.flags") },
    ],
};

/** Common item properties, shared by every item subtype variant. */
const itemPropertiesPanel: LayoutPanel = {
    title: "Item Properties",
    blocks: [
        {
            kind: "fields",
            fields: [
                p("itemProperties.subType"),
                p("itemProperties.material"),
                p("itemProperties.size"),
                p("itemProperties.weight"),
                p("itemProperties.cost"),
                p("itemProperties.inventoryFrmId"),
                p("itemProperties.attackModes"),
                p("itemProperties.scriptType"),
                p("itemProperties.scriptId"),
                p("itemProperties.soundId"),
            ],
        },
        { kind: "flags", field: p("itemProperties.flagsExt") },
    ],
};

/** Common scenery properties, shared by every scenery subtype variant. */
const sceneryPropertiesPanel: LayoutPanel = {
    title: "Scenery Properties",
    blocks: [
        {
            kind: "fields",
            fields: [
                p("sceneryProperties.subType"),
                p("sceneryProperties.material"),
                p("sceneryProperties.scriptType"),
                p("sceneryProperties.scriptId"),
                p("sceneryProperties.soundId"),
            ],
        },
        { kind: "flags", field: p("sceneryProperties.wallLightFlags") },
        { kind: "flags", field: p("sceneryProperties.actionFlags") },
    ],
};

/** A one-row variant: the common panels on row 1, then the subtype-specific panels. */
const variant = (commonPanels: LayoutPanel[], subtypePanels: LayoutPanel[]): { rows: LayoutRow[] } => ({
    rows: [{ panels: [...commonPanels, ...subtypePanels] }],
});

const itemVariant = (subtypePanels: LayoutPanel[]) => variant([headerPanel, itemPropertiesPanel], subtypePanels);
const sceneryVariant = (subtypePanels: LayoutPanel[]) => variant([headerPanel, sceneryPropertiesPanel], subtypePanels);

const fieldsPanel = (title: string, fields: string[]): LayoutPanel => ({ title, blocks: [{ kind: "fields", fields }] });

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
                    {
                        kind: "flags",
                        field: k("critterFlags"),
                        columns: 2,
                        // Plain-language tooltips for the cryptic engine flag names (keyed by flag label).
                        descriptions: {
                            Barter: "Can trade with",
                            NoSteal: "Cannot steal from",
                            NoDrop: "Doesn't drop items",
                            NoLimbs: "Cannot lose limbs",
                            NoAges: "Dead body does not disappear",
                            NoHeal: "Damage is not cured with time",
                            Invulnerable: "Cannot be hurt",
                            NoFlatten: "Leaves no dead body",
                            SpecialDeath: "There is a special type of death",
                            RangeMelee: "Melee attack is possible at a distance",
                            NoKnock: "Cannot be knocked down",
                        },
                    },
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
                        columnWidthPx: 230,
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
                                    baseBonus("Action Points", "actionPoints"),
                                    baseBonus("Armor Class", "armorClass"),
                                    baseBonus("Unarmed Damage", "unarmedDamage"),
                                    baseBonus("Melee Damage", "meleeDamage"),
                                    baseBonus("Carry Weight", "carryWeight"),
                                    baseBonus("Sequence", "sequence"),
                                    baseBonus("Healing Rate", "healingRate"),
                                    baseBonus("Critical %", "criticalChance"),
                                    baseBonus("Better Criticals", "betterCriticals"),
                                ],
                            },
                            {
                                label: "Damage Threshold",
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
                                label: "Damage Resistance",
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

/** Display-label overrides (see `FormatLayout.labels`) - expand the "Dest" truncation on scenery targets. */
const proLabels: Record<string, string> = {
    [p("stairsProperties.destTile")]: "Destination Tile",
    [p("stairsProperties.destElevation")]: "Destination Elevation",
    [p("stairsProperties.destMap")]: "Destination Map",
    [p("ladderProperties.destTile")]: "Destination Tile",
    [p("ladderProperties.destElevation")]: "Destination Elevation",
};

export const proLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "pro",
    maxContentWidthPx: 1000,
    labels: proLabels,
    variants: {
        critter: { rows: critterRows },

        // --- Item subtypes (object type 0): Header + Item Properties + subtype stats. ---
        "item.armor": itemVariant([
            fieldsPanel("Armor", [
                p("armorStats.ac"),
                p("armorStats.perk"),
                p("armorStats.maleFrmId"),
                p("armorStats.femaleFrmId"),
            ]),
            fieldsPanel("Damage Resistance", [
                p("armorStats.damageResistance.normal"),
                p("armorStats.damageResistance.laser"),
                p("armorStats.damageResistance.fire"),
                p("armorStats.damageResistance.plasma"),
                p("armorStats.damageResistance.electrical"),
                p("armorStats.damageResistance.emp"),
                p("armorStats.damageResistance.explosion"),
            ]),
            fieldsPanel("Damage Threshold", [
                p("armorStats.damageThreshold.normal"),
                p("armorStats.damageThreshold.laser"),
                p("armorStats.damageThreshold.fire"),
                p("armorStats.damageThreshold.plasma"),
                p("armorStats.damageThreshold.electrical"),
                p("armorStats.damageThreshold.emp"),
                p("armorStats.damageThreshold.explosion"),
            ]),
        ]),
        "item.weapon": itemVariant([
            fieldsPanel("Weapon", [
                p("weaponStats.animationCode"),
                p("weaponStats.damageType"),
                p("weaponStats.minDamage"),
                p("weaponStats.maxDamage"),
                p("weaponStats.minStrength"),
                p("weaponStats.maxRange1"),
                p("weaponStats.maxRange2"),
                p("weaponStats.apCost1"),
                p("weaponStats.apCost2"),
                p("weaponStats.rounds"),
                p("weaponStats.caliber"),
                p("weaponStats.ammoPid"),
                p("weaponStats.maxAmmo"),
                p("weaponStats.projectilePid"),
                p("weaponStats.criticalFail"),
                p("weaponStats.perk"),
                p("weaponStats.soundId"),
            ]),
        ]),
        "item.ammo": itemVariant([
            fieldsPanel("Ammo", [
                p("ammoStats.caliber"),
                p("ammoStats.quantity"),
                p("ammoStats.acModifier"),
                p("ammoStats.drModifier"),
                p("ammoStats.damageMultiplier"),
                p("ammoStats.damageDivisor"),
            ]),
        ]),
        "item.container": itemVariant([
            {
                title: "Container",
                blocks: [
                    { kind: "fields", fields: [p("containerStats.maxSize")] },
                    { kind: "flags", field: p("containerStats.openFlags") },
                ],
            },
        ]),
        "item.drug": itemVariant([
            fieldsPanel("Affected Stats", [
                p("drugStats.affectedStats.stat0"),
                p("drugStats.affectedStats.stat1"),
                p("drugStats.affectedStats.stat2"),
            ]),
            fieldsPanel("Instant Effect", [
                p("drugStats.instantEffect.amount0"),
                p("drugStats.instantEffect.amount1"),
                p("drugStats.instantEffect.amount2"),
            ]),
            fieldsPanel("Delayed Effect 1", [
                p("drugStats.delayedEffect1.duration"),
                p("drugStats.delayedEffect1.amount0"),
                p("drugStats.delayedEffect1.amount1"),
                p("drugStats.delayedEffect1.amount2"),
            ]),
            fieldsPanel("Delayed Effect 2", [
                p("drugStats.delayedEffect2.duration"),
                p("drugStats.delayedEffect2.amount0"),
                p("drugStats.delayedEffect2.amount1"),
                p("drugStats.delayedEffect2.amount2"),
            ]),
            fieldsPanel("Addiction", [
                p("drugStats.addiction.rate"),
                p("drugStats.addiction.effect"),
                p("drugStats.addiction.onset"),
            ]),
        ]),
        "item.key": itemVariant([fieldsPanel("Key", [p("keyStats.keyCode")])]),
        "item.misc": itemVariant([
            fieldsPanel("Misc Item", [
                p("miscItemStats.powerPid"),
                p("miscItemStats.powerType"),
                p("miscItemStats.charges"),
            ]),
        ]),

        // --- Scenery subtypes (object type 2): Header + Scenery Properties + subtype stats. ---
        "scenery.door": sceneryVariant([
            fieldsPanel("Door", [p("doorProperties.walkThrough"), p("doorProperties.unknown")]),
        ]),
        "scenery.stairs": sceneryVariant([
            fieldsPanel("Stairs", [
                p("stairsProperties.destTile"),
                p("stairsProperties.destElevation"),
                p("stairsProperties.destMap"),
            ]),
        ]),
        "scenery.elevator": sceneryVariant([
            fieldsPanel("Elevator", [p("elevatorProperties.elevatorType"), p("elevatorProperties.elevatorLevel")]),
        ]),
        "scenery.ladderTop": sceneryVariant([
            fieldsPanel("Ladder", [p("ladderProperties.destTile"), p("ladderProperties.destElevation")]),
        ]),
        "scenery.ladderBottom": sceneryVariant([
            fieldsPanel("Ladder", [p("ladderProperties.destTile"), p("ladderProperties.destElevation")]),
        ]),
        "scenery.generic": sceneryVariant([fieldsPanel("Generic", [p("genericProperties.unknown")])]),

        // --- Standalone object types: Header + a single properties panel. ---
        wall: variant(
            [headerPanel],
            [
                {
                    title: "Wall Properties",
                    blocks: [
                        {
                            kind: "fields",
                            fields: [
                                p("wallProperties.material"),
                                p("wallProperties.scriptType"),
                                p("wallProperties.scriptId"),
                            ],
                        },
                        { kind: "flags", field: p("wallProperties.wallLightFlags") },
                        { kind: "flags", field: p("wallProperties.actionFlags") },
                    ],
                },
            ],
        ),
        tile: variant([headerPanel], [fieldsPanel("Tile Properties", [p("tileProperties.material")])]),
        misc: variant([headerPanel], [fieldsPanel("Misc Properties", [p("miscProperties.unknown")])]),
    },
});
