/**
 * CRE declarative layout. Renders the creature on a single dense page instead of the legacy tabs: the
 * 105-field header is curated into logical panels (Identity / Stats / Combat / Resistances / Skills /
 * Colors / Scripts), the two flag words become flag columns, the 40 equipped-item slots a 2-column grid,
 * and the five variable-length sections (Known Spells, Spell Memorization Info, Memorized Spells, Effects,
 * Items) become master-detail list blocks. One variant ("creature"), stamped by the parser.
 *
 * Field refs are the CRE adapter's semantic keys (`cre.header.<camelCase>`, `cre.itemSlots.<slug>`, verified
 * against the model). Omitted from the layout (round-trip is unaffected - the serializer rebuilds from the
 * model):
 *   - signature/version magic (constants);
 *   - the serializer-managed section offset/count fields (knownSpellsOffset/Count, spellMemInfoOffset/Count,
 *     memorizedSpellsOffset/Count, itemSlotsOffset, itemsOffset/Count, effectsOffset/Count);
 *   - `effStructureVersion` (selects the on-wire effect record kind; editing it would desync the effects
 *     section, so it is parser/serializer-managed, not user-editable here);
 * The header slot arrays - soundSlots (100), objectRefs (5) - each get a per-slot key
 * (`cre.header.<group>.<slot>`, the adapter keeps the slot leaf in the key) and render as their own grids,
 * alongside the equipped item slots (40, distinct slot labels -> distinct slugs). Proficiencies are no longer
 * a slot array: the 20 bytes are 40 packed scalar header fields (`cre.header.proficiency<N>Active` /
 * `...Original`) rendered as a 2-column matrix (Active Class / Original Class).
 *
 * The Effects detail form renders the ~300-entry opcode as a searchable combobox via the spec's
 * `searchableEnum` flag (it flows through to the FormSection-rendered detail field, not just layout blocks).
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";
import { effV2BodyLabels, effV2BodyRows } from "./../eff/effect-body-layout";
import { creEffectV1BodyLabels, creEffectV1BodyRows } from "./effect-v1-layout";

// CRE embeds an effect record per `effStructureVersion`; v2 effects are byte-identical to a standalone `.eff`,
// so the Effects master-detail pane renders the SAME shared fragment (at the per-entry `cre.effects[].v2.`
// prefix) instead of a generic auto-form. v1 effects lack the v2 fields, so the fragment's refs won't all
// resolve and the editor falls back to the auto-form until a v1 fragment lands.
const CRE_EFFECTS_PREFIX = "cre.effects[].v2";

const k = (key: string): string => `cre.header.${key}`;
const slot = (key: string): string => `cre.itemSlots.${key}`;
/** Keys for a 1-based header slot array (soundSlots/objectRefs), e.g. `soundSlots`,`sound`,100. */
const slotKeys = (group: string, prefix: string, count: number): string[] =>
    Array.from({ length: count }, (_, i) => k(`${group}.${prefix}${i + 1}`));

/** BG1 weapon-proficiency names for the first 8 slots; the rest are unused in BG1/BG2 (kept generic). */
const PROFICIENCY_LABELS: readonly string[] = [
    "Large Swords",
    "Small Swords",
    "Bows",
    "Spears",
    "Blunt",
    "Spiked",
    "Axe",
    "Missile",
    ...Array.from({ length: 12 }, (_, i) => `Proficiency ${i + 9}`),
];

/**
 * Display-label overrides (see `FormatLayout.labels`): concise names applied at render time WITHOUT touching
 * field identity. Drops the category prefix the panel title already states, expands abbreviations, uppercases
 * acronyms, and names the object-ref slots (proficiency rows are labelled by the matrix). Script-slot labels drop the "Script " prefix - the
 * "Scripts" subgroup already states the category, so bare "Override"/"Class"/"Race"/etc. read cleanly there.
 */
const creLabels: Record<string, string> = {
    [k("animationId")]: "Animation ID",
    [k("levelFirstClass")]: "1st Level",
    [k("levelSecondClass")]: "2nd Level",
    [k("levelThirdClass")]: "3rd Level",
    [k("general")]: "General",
    [k("specific")]: "Specific",
    [k("enemyAlly")]: "Enemy / Ally",
    [k("moraleBreak")]: "Break",
    [k("moraleRecoveryTime")]: "Recovery Time",
    [k("thaco")]: "THAC0",
    [k("numAttacks")]: "Attacks",
    [k("acNatural")]: "Natural",
    [k("acEffective")]: "Effective",
    // acCrushing/Missile/Piercing/SlashingMod are per-damage-type AC modifiers; the "Mods" subgroup in the AC
    // panel gives the context, so the labels can be the bare damage type.
    [k("acCrushingMod")]: "Crushing",
    [k("acMissileMod")]: "Missile",
    [k("acPiercingMod")]: "Piercing",
    [k("acSlashingMod")]: "Slashing",
    [k("currentHp")]: "Current HP",
    [k("maxHp")]: "Maximum HP",
    [k("xpForKilling")]: "XP for Killing",
    [k("powerLevelOrXp")]: "Power Level / XP",
    [k("goldCarried")]: "Gold",
    [k("saveVsDeath")]: "Death",
    [k("saveVsWands")]: "Wands",
    [k("saveVsPolymorph")]: "Polymorph",
    [k("saveVsBreath")]: "Breath",
    [k("saveVsSpells")]: "Spells",
    [k("resistFire")]: "Fire",
    [k("resistCold")]: "Cold",
    [k("resistElectricity")]: "Electricity",
    [k("resistAcid")]: "Acid",
    [k("resistMagic")]: "Magic",
    [k("resistMagicFire")]: "Magic Fire",
    [k("resistMagicCold")]: "Magic Cold",
    [k("resistSlashing")]: "Slashing",
    [k("resistCrushing")]: "Crushing",
    [k("resistPiercing")]: "Piercing",
    [k("resistMissile")]: "Missile",
    [k("metalColor")]: "Metal",
    [k("minorColor")]: "Minor",
    [k("majorColor")]: "Major",
    [k("skinColor")]: "Skin",
    [k("leatherColor")]: "Leather",
    [k("armorColor")]: "Armor",
    [k("hairColor")]: "Hair",
    [k("globalActorEnum")]: "Global Actor ID",
    [k("localActorEnum")]: "Local Actor ID",
    // The death variable IS the creature's unique script name (the DV used in scripts and the
    // SPRITE_IS_DEAD_<name> global set on death).
    [k("deathVariable")]: "Script Name",
    [k("scriptOverride")]: "Override",
    [k("scriptClass")]: "Class",
    [k("scriptRace")]: "Race",
    [k("scriptGeneral")]: "General",
    [k("scriptDefault")]: "Default",
    [k("turnUndeadLevel")]: "Turn Undead",
    [k("trackingSkill")]: "Tracking",
    [k("findDisarmTraps")]: "Find Traps",
    // Proficiency row labels are supplied by the matrix block (PROFICIENCY_LABELS); the per-field
    // active/original packed keys need no separate display-label overrides.
    // objectRefs (OBJECT.IDS references) are intentionally not surfaced in the layout (see the Proficiencies
    // tab note), so they get no display labels here.
    // Embedded v2 effect labels, shared with the standalone `.eff` layout so the detail pane reads identically.
    ...effV2BodyLabels(CRE_EFFECTS_PREFIX),
    // EFF v1 effect labels (effStructureVersion 0); same prefix, distinct field slugs from v2.
    ...creEffectV1BodyLabels(CRE_EFFECTS_PREFIX),
};

export const creLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "cre",
    maxContentWidthPx: 1180,
    labels: creLabels,
    variants: {
        creature: {
            tabs: [
                {
                    id: "identity",
                    label: "Identity",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Identity",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("longName"),
                                                k("shortName"),
                                                k("smallPortrait"),
                                                k("largePortrait"),
                                                k("animationId"),
                                                k("xpForKilling"),
                                                k("powerLevelOrXp"),
                                                k("goldCarried"),
                                                k("reputation"),
                                                k("lore"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    // The Identity row's second column = the Scripting panel: the dialog file and Script Name
                                    // (death variable) as fields, with the five BCS script slots boxed as a subgroup below.
                                    title: "Scripting",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [k("dialogFile"), k("deathVariable")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Scripts",
                                            fields: [
                                                k("scriptOverride"),
                                                k("scriptClass"),
                                                k("scriptRace"),
                                                k("scriptGeneral"),
                                                k("scriptDefault"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    // What the creature *is*: enemyAlly (EA.IDS allegiance), general/specific
                                    // (GENERAL/SPECIFIC.IDS creature-type identifiers), race (RACE.IDS), sex/gender
                                    // (GENDER.IDS), and alignment (ALIGNMENT.IDS) - descriptive identifiers. The whole class
                                    // build (CLASS.IDS dropdown + kit + the multiclass Level row) nests below as a boxed
                                    // "Class" subgroup. 1-column (narrow) so it pairs beside the Identity panel; `stack`
                                    // puts the subgroup under the field list rather than beside it.
                                    title: "Classification",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("enemyAlly"),
                                                k("general"),
                                                k("specific"),
                                                k("race"),
                                                k("sex"),
                                                k("gender"),
                                                k("alignment"),
                                            ],
                                        },
                                        {
                                            kind: "group",
                                            label: "Class",
                                            fields: [
                                                k("class"),
                                                k("kit"),
                                                k("levelFirstClass"),
                                                k("levelSecondClass"),
                                                k("levelThirdClass"),
                                            ],
                                            joins: [
                                                {
                                                    label: "Level",
                                                    separator: " ",
                                                    fields: [
                                                        k("levelFirstClass"),
                                                        k("levelSecondClass"),
                                                        k("levelThirdClass"),
                                                    ],
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
                                    title: "Attributes",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("strength"),
                                                k("strengthBonus"),
                                                k("intelligence"),
                                                k("wisdom"),
                                                k("dexterity"),
                                                k("constitution"),
                                                k("charisma"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    // Skills: turn-undead level and ranger tracking, with the thief skills boxed as a
                                    // "Thief" subgroup below (Fatigue/Intoxication live in Combat).
                                    title: "Skills",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [k("turnUndeadLevel"), k("trackingSkill")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Thief",
                                            columns: 2,
                                            fields: [
                                                k("detectIllusion"),
                                                k("setTraps"),
                                                k("lockpicking"),
                                                k("moveSilently"),
                                                k("findDisarmTraps"),
                                                k("pickPockets"),
                                                k("hideInShadows"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Flags",
                                    blocks: [{ kind: "flags", field: k("creatureFlags"), columns: 4, spread: true }],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Other",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [k("trackingTarget"), k("globalActorEnum"), k("localActorEnum")],
                                        },
                                    ],
                                },
                                {
                                    title: "Colors",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("metalColor"),
                                                k("minorColor"),
                                                k("majorColor"),
                                                k("skinColor"),
                                                k("leatherColor"),
                                                k("armorColor"),
                                                k("hairColor"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "combat",
                    label: "Combat",
                    rows: [
                        {
                            panels: [
                                {
                                    // Combat stats merged into one group: attacks + health + condition + luck. Morale and AC
                                    // are their own groups beside this one.
                                    title: "Combat",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("thaco"),
                                                k("numAttacks"),
                                                // Racial Enemy (ranger favoured-enemy race, RACE.IDS) - a combat-targeting attribute.
                                                k("racialEnemy"),
                                                k("currentHp"),
                                                k("maxHp"),
                                                k("fatigue"),
                                                k("intoxication"),
                                                k("luck"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "AC",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [k("acNatural"), k("acEffective")],
                                        },
                                        {
                                            // Per-damage-type AC modifiers, boxed - the "Mod" label gives the context so the
                                            // entries can be bare damage types.
                                            kind: "group",
                                            label: "Mod",
                                            fields: [
                                                k("acCrushingMod"),
                                                k("acMissileMod"),
                                                k("acPiercingMod"),
                                                k("acSlashingMod"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Saving Throws",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("saveVsDeath"),
                                                k("saveVsWands"),
                                                k("saveVsPolymorph"),
                                                k("saveVsBreath"),
                                                k("saveVsSpells"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Morale",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [k("morale"), k("moraleBreak"), k("moraleRecoveryTime")],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Resistances",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("resistFire"),
                                                k("resistCold"),
                                                k("resistElectricity"),
                                                k("resistAcid"),
                                                k("resistMagic"),
                                                k("resistMagicFire"),
                                                k("resistMagicCold"),
                                                k("resistSlashing"),
                                                k("resistCrushing"),
                                                k("resistPiercing"),
                                                k("resistMissile"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    // 24 status bits: spread across the full-width row.
                                    title: "Status",
                                    blocks: [{ kind: "flags", field: k("statusFlags"), columns: 6, spread: true }],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "inventory",
                    label: "Inventory",
                    countFrom: "Items",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Item Slots",
                                    blocks: [
                                        {
                                            kind: "grid",
                                            columns: 4,
                                            items: [
                                                slot("helmet"),
                                                slot("armor"),
                                                slot("shield"),
                                                slot("gloves"),
                                                slot("leftRing"),
                                                slot("rightRing"),
                                                slot("amulet"),
                                                slot("belt"),
                                                slot("boots"),
                                                slot("weapon1"),
                                                slot("weapon2"),
                                                slot("weapon3"),
                                                slot("weapon4"),
                                                slot("quiver1"),
                                                slot("quiver2"),
                                                slot("quiver3"),
                                                slot("quiver4"),
                                                slot("cloak"),
                                                slot("quickItem1"),
                                                slot("quickItem2"),
                                                slot("quickItem3"),
                                                slot("inventory1"),
                                                slot("inventory2"),
                                                slot("inventory3"),
                                                slot("inventory4"),
                                                slot("inventory5"),
                                                slot("inventory6"),
                                                slot("inventory7"),
                                                slot("inventory8"),
                                                slot("inventory9"),
                                                slot("inventory10"),
                                                slot("inventory11"),
                                                slot("inventory12"),
                                                slot("inventory13"),
                                                slot("inventory14"),
                                                slot("inventory15"),
                                                slot("inventory16"),
                                                slot("magicWeapon"),
                                                slot("selectedWeapon"),
                                                slot("selectedWeaponAbility"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Items",
                                    blocks: [
                                        {
                                            kind: "list",
                                            sectionKey: "Items",
                                            render: "master-detail",
                                            canAdd: true,
                                            canModify: true,
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "proficiencies",
                    label: "Proficiencies",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Proficiencies",
                                    blocks: [
                                        {
                                            // Each of the 20 proficiency bytes packs an "active class" (bits 0-2) and an
                                            // "original class" (bits 3-5) sub-value (IESDP cre_v1.htm); render as a 2-column
                                            // matrix, one row per slot.
                                            kind: "matrix",
                                            // Wider than the 190 default: the proficiency row labels ("Large Swords",
                                            // "Proficiency 9") are longer than the short stat-table labels the matrix
                                            // defaults to, so the label column needs the extra width to not ellipsize.
                                            columnWidthPx: 280,
                                            valueColumns: [
                                                { key: "active", label: "Active Class" },
                                                { key: "original", label: "Original Class" },
                                            ],
                                            groups: [
                                                {
                                                    label: "Proficiencies",
                                                    rows: PROFICIENCY_LABELS.map((label, i) => ({
                                                        label,
                                                        cells: {
                                                            active: k(`proficiency${i + 1}Active`),
                                                            original: k(`proficiency${i + 1}Original`),
                                                        },
                                                    })),
                                                },
                                            ],
                                        },
                                    ],
                                },
                                // Design choice: the objectRefs field (0x0276, IESDP "OBJECT.IDS references" - 5 bytes
                                // the engine sets at runtime to target this creature in scripts) is intentionally NOT
                                // surfaced in the editor. The per-byte split has no hand-editable meaning, the value is
                                // effectively always zero, and exposing it ("Tracked Objects") only confused. It stays in
                                // the parser/model, so the file still round-trips byte-identically; only the UI omits it.
                            ],
                        },
                    ],
                },
                {
                    id: "sounds",
                    label: "Sounds",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Sound Slots",
                                    blocks: [{ kind: "grid", columns: 6, items: slotKeys("soundSlots", "sound", 100) }],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "spells",
                    label: "Spells",
                    tabs: [
                        {
                            id: "known",
                            label: "Known",
                            countFrom: "Known Spells",
                            rows: [
                                {
                                    panels: [
                                        {
                                            title: "Known Spells",
                                            blocks: [
                                                {
                                                    kind: "list",
                                                    sectionKey: "Known Spells",
                                                    render: "master-detail",
                                                    canAdd: true,
                                                    canModify: true,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            id: "memorization",
                            label: "Memorization",
                            countFrom: "Spell Memorization Info",
                            rows: [
                                {
                                    panels: [
                                        {
                                            title: "Spell Memorization Info",
                                            blocks: [
                                                {
                                                    kind: "list",
                                                    sectionKey: "Spell Memorization Info",
                                                    render: "master-detail",
                                                    canAdd: true,
                                                    canModify: true,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            id: "memorized",
                            label: "Memorized",
                            countFrom: "Memorized Spells",
                            rows: [
                                {
                                    panels: [
                                        {
                                            title: "Memorized Spells",
                                            blocks: [
                                                {
                                                    kind: "list",
                                                    sectionKey: "Memorized Spells",
                                                    render: "master-detail",
                                                    canModify: true,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "effects",
                    label: "Effects",
                    countFrom: "Effects",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Effects",
                                    blocks: [
                                        {
                                            kind: "list",
                                            sectionKey: "Effects",
                                            render: "master-detail",
                                            canAdd: true,
                                            canModify: true,
                                            // Shared with standalone `.eff`: a CRE v2 effect renders the same panels.
                                            detailVariant: effV2BodyRows(CRE_EFFECTS_PREFIX),
                                            // effStructureVersion 0 embeds the older EFF v1 record (a distinct,
                                            // smaller layout); the v2 fragment declines it and this fallback renders.
                                            detailVariantFallbacks: [creEffectV1BodyRows(CRE_EFFECTS_PREFIX)],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
            ],
        },
    },
});
