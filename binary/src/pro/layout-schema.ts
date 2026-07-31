/**
 * PRO declarative layout. Attached to the PRO adapter so the editor renders PRO on a single dense page
 * via the generic layout renderer instead of the legacy depth-0-groups-as-tabs path. The active variant
 * is chosen by the parse result's `variantId` (see `proVariantId` in `index.ts`).
 *
 * Every PRO object/sub type has a variant: critter (the worked mockup), the seven item subtypes
 * (weapon/armor/ammo/drug/misc/key/container), the six scenery subtypes (door/stairs/elevator/ladderTop/
 * ladderBottom/generic), and wall/tile/misc. With all variants present the parser never falls back to the
 * legacy depth-0-groups-as-tabs path (since retired).
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
            columns: 2,
            fields: [
                p("itemProperties.subType"),
                p("itemProperties.material"),
                p("itemProperties.size"),
                p("itemProperties.weight"),
                p("itemProperties.cost"),
                p("itemProperties.inventoryFrmId"),
                p("itemProperties.attackModePrimary"),
                p("itemProperties.attackModeSecondary"),
                p("itemProperties.scriptType"),
                p("itemProperties.scriptId"),
                p("itemProperties.soundId"),
            ],
        },
        { kind: "flags", field: p("itemProperties.flagsExt") },
    ],
};

/** Weapon-only Item Properties: the common item fields MINUS the two attack-mode dropdowns, which move into
 *  the Weapon variant's Primary/Secondary Attack groups (fused with their AP cost + range). Other item
 *  subtypes keep attack modes here; for a weapon they belong with the attack stats. */
const weaponItemPropertiesPanel: LayoutPanel = {
    title: "Item Properties",
    blocks: [
        {
            kind: "fields",
            columns: 2,
            fields: [
                p("itemProperties.subType"),
                p("itemProperties.material"),
                p("itemProperties.size"),
                p("itemProperties.weight"),
                p("itemProperties.cost"),
                p("itemProperties.inventoryFrmId"),
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

const fieldsPanel = (title: string, fields: string[], columns?: number): LayoutPanel => ({
    title,
    blocks: [{ kind: "fields", fields, ...(columns !== undefined && { columns }) }],
});

/** A matrix row whose Base/Bonus cells are `<key>` and `<key>Bonus`. */
function baseBonus(label: string, key: string): { label: string; cells: Record<string, string> } {
    return { label, cells: { base: k(key), bonus: k(`${key}Bonus`) } };
}

const critterRows: LayoutRow[] = [
    // Top row: file Header (incl. read-only object type) | Scripts & AI | Demographics | Combat - clumped left.
    {
        panels: [
            headerPanel,
            {
                title: "Scripts & AI",
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
                    {
                        kind: "flags",
                        field: k("flagsExt"),
                        columns: 1,
                        // Proto "Flags Ext" action flags - which interactions the critter allows.
                        descriptions: {
                            Look: "Can be examined",
                            "Can talk to": "Conversation is possible",
                        },
                    },
                ],
            },
            { title: "Demographics", blocks: [{ kind: "fields", fields: [k("age"), k("gender")] }] },
            {
                title: "Combat & Classification",
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
                        // 260px: the longest secondary-stat label ("Better Criticals" / "Unarmed Damage")
                        // plus the two Base|Bonus value cells fit without the label ellipsizing.
                        kind: "matrix",
                        columnWidthPx: 260,
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
    // Drug delayed-effect onset durations, tied to the matrix's "Delayed 1 / Delayed 2" amount columns.
    [p("drugStats.delayedEffect1.duration")]: "Delayed 1 After",
    [p("drugStats.delayedEffect2.duration")]: "Delayed 2 After",
};

export const proLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "pro",
    maxContentWidthPx: 1000,
    labels: proLabels,
    // Variant discriminators: shown for context but read-only (editing them desyncs the stamped variant).
    readOnlyFields: [p("header.objectType"), p("itemProperties.subType"), p("sceneryProperties.subType")],
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
        // Weapon uses the trimmed Item Properties panel (attack modes move into the Attack groups below).
        "item.weapon": variant(
            [headerPanel, weaponItemPropertiesPanel],
            [
                {
                    title: "Weapon",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [
                                p("weaponStats.animationCode"),
                                p("weaponStats.damageType"),
                                p("weaponStats.minDamage"),
                                p("weaponStats.maxDamage"),
                                p("weaponStats.minStrength"),
                                p("weaponStats.rounds"),
                                p("weaponStats.caliber"),
                                p("weaponStats.ammoPid"),
                                p("weaponStats.maxAmmo"),
                                p("weaponStats.projectilePid"),
                                p("weaponStats.criticalFail"),
                                p("weaponStats.perk"),
                                p("weaponStats.soundId"),
                            ],
                            // Fallout weapons store a flat min/max damage pair (not dice); fold it into one
                            // "Min - Max" cell, the range analog of the ITM ability's XdY+Z dice join.
                            joins: [
                                {
                                    label: "Damage",
                                    fields: [p("weaponStats.minDamage"), p("weaponStats.maxDamage")],
                                    separator: " - ",
                                },
                            ],
                        },
                    ],
                },
                // A weapon has two attack modes; each is (mode, AP cost, range). The mode lives in the common
                // item byte and the AP/range in the weapon struct - fuse each across that parse boundary into
                // one boxed group so the two modes read as coherent units (fallout2-ce Weapon.maxRange[2] /
                // movePointCost[2] are indexed by mode: index 0 primary, index 1 secondary).
                {
                    title: "Attack",
                    blocks: [
                        {
                            kind: "group",
                            label: "Primary Attack",
                            fields: [
                                p("itemProperties.attackModePrimary"),
                                p("weaponStats.apCost1"),
                                p("weaponStats.maxRange1"),
                            ],
                        },
                        {
                            kind: "group",
                            label: "Secondary Attack",
                            fields: [
                                p("itemProperties.attackModeSecondary"),
                                p("weaponStats.apCost2"),
                                p("weaponStats.maxRange2"),
                            ],
                        },
                    ],
                },
            ],
        ),
        "item.ammo": itemVariant([
            {
                title: "Ammo",
                blocks: [
                    {
                        kind: "fields",
                        columns: 2,
                        fields: [
                            p("ammoStats.caliber"),
                            p("ammoStats.quantity"),
                            p("ammoStats.acModifier"),
                            p("ammoStats.drModifier"),
                            p("ammoStats.damageMultiplier"),
                            p("ammoStats.damageDivisor"),
                        ],
                        // Ammo scales target damage by multiplier/divisor (fallout2-ce Ammo damageMult/damageDiv);
                        // fold the pair into one "N / M" cell so it reads as the single fraction it is.
                        joins: [
                            {
                                label: "Damage Mod",
                                fields: [p("ammoStats.damageMultiplier"), p("ammoStats.damageDivisor")],
                                separator: " / ",
                            },
                        ],
                    },
                ],
            },
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
        // A drug's effect data is three parallel arrays (fallout2-ce Drug: stats[3], immediateEffect[3],
        // delayed[2].effect[3]): each affected stat gets an instant amount plus two delayed amounts. Render it
        // stat-major as one matrix (a row per affected stat) instead of the old phase-major panels that forced
        // the reader to mentally zip stat0 with amount0. The two onset durations are per-phase, not per-stat, so
        // they sit in a small Delays panel beside the matrix's Delayed 1 / Delayed 2 columns.
        "item.drug": itemVariant([
            {
                title: "Effects",
                blocks: [
                    {
                        kind: "matrix",
                        columnWidthPx: 440,
                        valueColumns: [
                            // The affected-stat column holds a StatType dropdown - widen it past the default 56px
                            // numeric cell so the option labels do not clip.
                            { key: "stat", label: "Affected Stat", widthPx: 170 },
                            { key: "instant", label: "Instant", widthPx: 74 },
                            { key: "delayed1", label: "Delayed 1", widthPx: 74 },
                            { key: "delayed2", label: "Delayed 2", widthPx: 74 },
                        ],
                        groups: [
                            {
                                label: "",
                                rows: [0, 1, 2].map((i) => ({
                                    label: "",
                                    cells: {
                                        stat: p(`drugStats.affectedStats.stat${i}`),
                                        instant: p(`drugStats.instantEffect.amount${i}`),
                                        delayed1: p(`drugStats.delayedEffect1.amount${i}`),
                                        delayed2: p(`drugStats.delayedEffect2.amount${i}`),
                                    },
                                })),
                            },
                        ],
                    },
                ],
            },
            {
                title: "Delays",
                fit: true,
                blocks: [
                    {
                        kind: "fields",
                        fields: [p("drugStats.delayedEffect1.duration"), p("drugStats.delayedEffect2.duration")],
                    },
                ],
            },
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
        // Single-field property panels: `fit` keeps them content-width (sharing the row with the Header
        // panel, which grows) instead of stretching one field across half the screen.
        tile: variant(
            [headerPanel],
            [
                {
                    title: "Tile Properties",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [p("tileProperties.material")] }],
                },
            ],
        ),
        misc: variant(
            [headerPanel],
            [
                {
                    title: "Misc Properties",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [p("miscProperties.unknown")] }],
                },
            ],
        ),
    },
});
