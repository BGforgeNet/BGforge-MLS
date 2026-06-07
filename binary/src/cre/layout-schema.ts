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
 * The header slot arrays - proficiencies (22), soundSlots (100), objectRefs (5) - each get a per-slot key
 * (`cre.header.<group>.<slot>`, the adapter keeps the slot leaf in the key) and render as their own grids,
 * alongside the equipped item slots (40, distinct slot labels -> distinct slugs).
 *
 * The Effects detail form renders the ~300-entry opcode as a searchable combobox via the spec's
 * `searchableEnum` flag (it flows through to the FormSection-rendered detail field, not just layout blocks).
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";

const k = (key: string): string => `cre.header.${key}`;
const slot = (key: string): string => `cre.itemSlots.${key}`;
/** Keys for a 1-based header slot array (proficiencies/soundSlots/objectRefs), e.g. `proficiencies`,`slot`,22. */
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
    ...Array.from({ length: 14 }, (_, i) => `Proficiency ${i + 9}`),
];

/**
 * Display-label overrides (see `FormatLayout.labels`): concise names applied at render time WITHOUT touching
 * field identity. Drops the category prefix the panel title already states, expands abbreviations, uppercases
 * acronyms, and names the proficiency / object-ref slots. Script-slot labels are intentionally NOT here (they
 * keep "Script X" - bare "Class"/"Race" would be ambiguous and the panel groups them anyway).
 */
const creLabels: Record<string, string> = {
    [k("animationId")]: "Animation ID",
    [k("levelFirstClass")]: "1st Level",
    [k("levelSecondClass")]: "2nd Level",
    [k("levelThirdClass")]: "3rd Level",
    [k("general")]: "General Type",
    [k("specific")]: "Specific Type",
    [k("enemyAlly")]: "Enemy / Ally",
    [k("moraleBreak")]: "Break",
    [k("moraleRecoveryTime")]: "Recovery Time",
    [k("thaco")]: "THAC0",
    [k("numAttacks")]: "Attacks",
    [k("acNatural")]: "AC: Natural",
    [k("acEffective")]: "AC: Effective",
    [k("acCrushingMod")]: "AC: Crushing",
    [k("acMissileMod")]: "AC: Missile",
    [k("acPiercingMod")]: "AC: Piercing",
    [k("acSlashingMod")]: "AC: Slashing",
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
    ...Object.fromEntries(PROFICIENCY_LABELS.map((label, i) => [k(`proficiencies.slot${i + 1}`), label])),
    // objectRefs stay positional ("Object 1".."5") under the clearer "Tracked Objects" panel - they are an
    // ordered OBJECT.IDS tuple with no per-slot meaning, like the sound slots.
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
                                            columns: 2,
                                            fields: [
                                                k("longName"),
                                                k("shortName"),
                                                k("smallPortrait"),
                                                k("largePortrait"),
                                                k("animationId"),
                                                k("sex"),
                                                k("gender"),
                                                k("reputation"),
                                                k("kit"),
                                                k("racialEnemy"),
                                            ],
                                        },
                                    ],
                                },
                                { title: "Flags", blocks: [{ kind: "flags", field: k("creatureFlags"), columns: 2 }] },
                                {
                                    title: "Status Flags",
                                    blocks: [{ kind: "flags", field: k("statusFlags"), columns: 3 }],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Class & Alignment",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("class"),
                                                k("levelFirstClass"),
                                                k("levelSecondClass"),
                                                k("levelThirdClass"),
                                                k("race"),
                                                k("alignment"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    // enemyAlly (EA.IDS allegiance) + general/specific (GENERAL/SPECIFIC.IDS creature-type
                                    // identifiers) are classification, not class/alignment - split out per the UX redesign.
                                    title: "Classification",
                                    blocks: [{ kind: "fields", fields: [k("enemyAlly"), k("general"), k("specific")] }],
                                },
                                {
                                    title: "Attributes",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
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
                                    // Luck is a SPECIAL-style stat (not morale); Lore is a knowledge stat (not a thief skill).
                                    title: "Stats",
                                    blocks: [{ kind: "fields", fields: [k("luck"), k("lore")] }],
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
                    ],
                },
                {
                    id: "combat",
                    label: "Combat",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Combat",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("thaco"),
                                                k("numAttacks"),
                                                k("acNatural"),
                                                k("acEffective"),
                                                k("acCrushingMod"),
                                                k("acMissileMod"),
                                                k("acPiercingMod"),
                                                k("acSlashingMod"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Health & XP",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("currentHp"),
                                                k("maxHp"),
                                                k("xpForKilling"),
                                                k("powerLevelOrXp"),
                                                k("goldCarried"),
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
                                {
                                    // Thief skills proper. Lore (knowledge) -> Stats; Fatigue/Intoxication (condition)
                                    // -> Condition; Hide In Shadows moved in from Combat (it is a thief skill byte).
                                    title: "Thief Skills",
                                    blocks: [
                                        {
                                            kind: "fields",
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
                                {
                                    title: "Condition",
                                    blocks: [{ kind: "fields", fields: [k("fatigue"), k("intoxication")] }],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "appearance",
                    label: "Appearance & Scripts",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Colors",
                                    blocks: [
                                        {
                                            kind: "fields",
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
                                {
                                    title: "Scripts and Dialogs",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("scriptOverride"),
                                                k("scriptClass"),
                                                k("scriptRace"),
                                                k("scriptGeneral"),
                                                k("scriptDefault"),
                                                k("dialogFile"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "References",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("deathVariable"),
                                                k("trackingTarget"),
                                                k("globalActorEnum"),
                                                k("localActorEnum"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "inventory",
                    label: "Inventory",
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
                    ],
                },
                {
                    id: "slots",
                    label: "Proficiencies & Sounds",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Proficiencies",
                                    blocks: [
                                        { kind: "grid", columns: 4, items: slotKeys("proficiencies", "slot", 22) },
                                    ],
                                },
                                {
                                    title: "Tracked Objects",
                                    blocks: [{ kind: "grid", columns: 5, items: slotKeys("objectRefs", "object", 5) }],
                                },
                            ],
                        },
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
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "items",
                    label: "Items",
                    countFrom: "Items",
                    rows: [
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
            ],
        },
    },
});
