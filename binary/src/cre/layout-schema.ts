/**
 * CRE declarative layout. The header scalars are grouped into compact single-column titled boxes packed side
 * by side, split across a General tab (Main, Identity, Scripting on the first row; Attributes, Thief Skills,
 * Extra Stats, Colors on the second; plus the creatureFlags grid and a short trailing table) and a Combat tab
 * (Main attack stats, AC, Saving Throws, Resistances, and the statusFlags grid). Related fields nest into
 * subgroups (Identity's Class/Level, Scripting's Scripts, AC's Mod, Extra Stats' Morale, the elemental/magic/
 * physical resistance split). The structurally distinct header data keeps its own tabs (equipped item slots +
 * the Items list under Inventory, the 100 sound slots, the 20 packed proficiency bytes as a matrix), and the
 * variable-length sections (Known Spells, Spell Memorization Info, Memorized Spells, Effects) stay as
 * master-detail list blocks under Spells / Effects. One variant ("creature"), stamped by the parser.
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

// Per-entry field-ref prefix for an inventory item in the Items master-detail list (the adapter keys each
// item's fields under `cre.items[].<key>`); used by the Items detailVariant and its quantity label overrides.
const CRE_ITEMS_PREFIX = "cre.items[]";
const itemRef = (key: string): string => `${CRE_ITEMS_PREFIX}.${key}`;

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
 * field identity. Fields that sit bare in the flat wire-order list carry their own context in the label
 * ("Morale Break", "Script Class" - the latter so it never collides with the bare "class" field). Fields
 * inside a boxed group (AC, Colors, Saving Throws, Resistances) use the bare leaf instead, since the group
 * legend supplies the category.
 */
const creLabels: Record<string, string> = {
    [k("animationId")]: "Animation ID",
    [k("levelFirstClass")]: "1st Level",
    [k("levelSecondClass")]: "2nd Level",
    [k("levelThirdClass")]: "3rd Level",
    [k("general")]: "General",
    [k("specific")]: "Specific",
    [k("enemyAlly")]: "Enemy / Ally",
    // Inside the "Morale" subgroup, so the members drop the "Morale" prefix.
    [k("moraleBreak")]: "Break",
    [k("moraleRecoveryTime")]: "Recovery",
    [k("thaco")]: "THAC0",
    [k("numAttacks")]: "Attacks",
    [k("acNatural")]: "Natural",
    [k("acEffective")]: "Effective",
    // The "Mods" subgroup inside the AC box marks these as per-damage-type modifiers, so each uses the bare
    // damage type (distinct from the same damage types under Resistances by virtue of the subgroup).
    [k("acCrushingMod")]: "Crushing",
    [k("acMissileMod")]: "Missile",
    [k("acPiercingMod")]: "Piercing",
    [k("acSlashingMod")]: "Slashing",
    [k("currentHp")]: "Current HP",
    [k("maxHp")]: "Maximum HP",
    [k("xpForKilling")]: "XP for Killing",
    [k("powerLevelOrXp")]: "Power Level / XP",
    [k("goldCarried")]: "Gold",
    // Saving Throws / Resistances / Colors render as boxed groups whose legend states the category, so each
    // member uses the bare leaf label.
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
    // Inventory-item quantities (the three charge/stack counts), spaced before the trailing digit that
    // humanize leaves attached ("Quantity1"). They form the middle column of the Items detail.
    [itemRef("quantity1")]: "Quantity 1",
    [itemRef("quantity2")]: "Quantity 2",
    [itemRef("quantity3")]: "Quantity 3",
    // The death variable IS the creature's unique script name (the DV used in scripts and the
    // SPRITE_IS_DEAD_<name> global set on death).
    [k("deathVariable")]: "Script Name",
    // The "Scripts" subgroup supplies the category, so the five BCS script slots use the bare slot name.
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
                    id: "general",
                    label: "General",
                    // Header fields, drawn from specs/header.ts. The General tab packs single-column titled boxes across
                    // two rows - Main (names + core stats), Identity, Scripting on the first; Attributes, Thief Skills,
                    // Extra Stats, Colors on the second - then the creature-flag grid and a short trailing table. The
                    // Combat tab carries Main (attack stats), AC, saving throws, resistances, and the status flags.
                    // Boxing relaxes strict wire order. Omitted: signature/version magic, effStructureVersion
                    // (parser/serializer-managed), the section offset/count pairs, and objectRefs (not surfaced).
                    // proficiencies, soundSlots, and the equipped item slots live in their own tabs.
                    rows: [
                        {
                            // The logical clusters as single-column titled panels in one row. `.layout-row` wraps them
                            // and the panels grow to fill, so they pack as side-by-side stat boxes. Identity gathers the
                            // IDS dropdowns; Scripting gathers the dialog file, script name, and the five BCS script
                            // slots. hideInShadows is pulled into Thief Skills from its earlier wire slot; lore
                            // (interleaved among the thief skills in wire order but a knowledge stat) stays loose below.
                            panels: [
                                {
                                    // The names plus core stats, leading the page: tooltip/dialog strrefs, experience/
                                    // gold, health, animation, portraits, and reputation (THAC0/attacks live on Combat).
                                    title: "Main",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [
                                                k("longName"),
                                                k("shortName"),
                                                k("xpForKilling"),
                                                k("powerLevelOrXp"),
                                                k("goldCarried"),
                                                k("currentHp"),
                                                k("maxHp"),
                                                k("animationId"),
                                                k("smallPortrait"),
                                                k("largePortrait"),
                                                k("reputation"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Identity",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [k("enemyAlly"), k("general"), k("specific"), k("race")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Class",
                                            columns: 1,
                                            // The three multiclass level bytes fold into one "Level [] [] []" inline row
                                            // via the join; a single-class creature uses only the first.
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
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [k("sex"), k("gender"), k("alignment"), k("racialEnemy")],
                                        },
                                    ],
                                },
                                {
                                    title: "Scripting",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [k("deathVariable"), k("dialogFile")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Scripts",
                                            columns: 1,
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
                            ],
                        },
                        {
                            // Second row: attributes, thief skills, extra stats, and colors.
                            panels: [
                                {
                                    title: "Attributes",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            // strength + strengthBonus fold into one "Strength [] / []" row (the
                                            // percentile bonus applies only at STR 18).
                                            fields: [
                                                k("strength"),
                                                k("strengthBonus"),
                                                k("dexterity"),
                                                k("constitution"),
                                                k("intelligence"),
                                                k("wisdom"),
                                                k("charisma"),
                                            ],
                                            joins: [
                                                {
                                                    label: "Strength",
                                                    separator: "/",
                                                    fields: [k("strength"), k("strengthBonus")],
                                                },
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Thief Skills",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [
                                                k("lockpicking"),
                                                k("findDisarmTraps"),
                                                k("pickPockets"),
                                                k("moveSilently"),
                                                k("hideInShadows"),
                                                k("detectIllusion"),
                                                k("setTraps"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Extra Stats",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [
                                                k("lore"),
                                                k("fatigue"),
                                                k("intoxication"),
                                                k("luck"),
                                                k("turnUndeadLevel"),
                                                k("trackingSkill"),
                                            ],
                                        },
                                        {
                                            kind: "group",
                                            label: "Morale",
                                            columns: 1,
                                            fields: [k("morale"), k("moraleBreak"), k("moraleRecoveryTime")],
                                        },
                                    ],
                                },
                                {
                                    title: "Colors",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
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
                        {
                            // 32 creature-flag bits, full-width flag-column grid; legend = the field's display name.
                            panels: [
                                {
                                    blocks: [{ kind: "flags", field: k("creatureFlags"), columns: 4, spread: true }],
                                },
                            ],
                        },
                        {
                            // The few remaining loose scalars: the tracking-target resref and the two runtime actor
                            // enums (the rest of the loose stats moved into the Extra Stats box above).
                            panels: [
                                {
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 4,
                                            fields: [k("trackingTarget"), k("globalActorEnum"), k("localActorEnum")],
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
                            // The combat boxes: Main (attack stats) and the defensive boxes (AC, saving throws,
                            // resistances), packed side by side like the General clusters.
                            panels: [
                                {
                                    title: "Main",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [k("thaco"), k("numAttacks")],
                                        },
                                    ],
                                },
                                {
                                    title: "AC",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 1,
                                            fields: [k("acNatural"), k("acEffective")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Mod",
                                            columns: 1,
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
                                            columns: 1,
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
                                    title: "Resistances",
                                    stack: true,
                                    blocks: [
                                        {
                                            kind: "group",
                                            label: "Elemental",
                                            columns: 2,
                                            fields: [
                                                k("resistFire"),
                                                k("resistCold"),
                                                k("resistElectricity"),
                                                k("resistAcid"),
                                            ],
                                        },
                                        {
                                            kind: "group",
                                            label: "Magic",
                                            columns: 2,
                                            fields: [k("resistMagic"), k("resistMagicFire"), k("resistMagicCold")],
                                        },
                                        {
                                            kind: "group",
                                            label: "Physical",
                                            columns: 2,
                                            fields: [
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
                            // 24 status bits, full-width.
                            panels: [
                                {
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
                                            // Three side-by-side columns in a single untitled pane (no per-
                                            // column group boxes): the item ref + its expiration, the charge/
                                            // stack quantities, and the item flags.
                                            detailVariant: [
                                                {
                                                    panels: [
                                                        {
                                                            blocks: [
                                                                {
                                                                    kind: "fields",
                                                                    columns: 1,
                                                                    fields: [
                                                                        itemRef("item"),
                                                                        itemRef("expirationTime"),
                                                                    ],
                                                                },
                                                                {
                                                                    kind: "fields",
                                                                    columns: 1,
                                                                    fields: [
                                                                        itemRef("quantity1"),
                                                                        itemRef("quantity2"),
                                                                        itemRef("quantity3"),
                                                                    ],
                                                                },
                                                                {
                                                                    kind: "flags",
                                                                    field: itemRef("itemFlags"),
                                                                    columns: 1,
                                                                },
                                                            ],
                                                        },
                                                    ],
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
