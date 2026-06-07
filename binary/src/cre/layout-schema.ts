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
 *   - the slot arrays whose per-slot fields currently collapse to one semantic key - proficiencies (22),
 *     soundSlots (100), objectRefs (5). Each routes through the header namespace with the sub-group name as
 *     the field segment, so all entries share one key and the layout cannot reference them individually.
 *     Deferred: a future parser-key change can give the bytes distinct keys; until then they are not
 *     editable in the dense view (the bytes still round-trip). Item slots do NOT collapse (distinct slot
 *     labels -> distinct slugs), so they are included as a grid.
 *
 * The Effects detail form renders the ~300-entry opcode as a searchable combobox via the spec's
 * `searchableEnum` flag (it flows through to the FormSection-rendered detail field, not just layout blocks).
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";

const k = (key: string): string => `cre.header.${key}`;
const slot = (key: string): string => `cre.itemSlots.${key}`;

export const creLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "cre",
    maxContentWidthPx: 1180,
    variants: {
        creature: {
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
                                        k("sex"),
                                        k("gender"),
                                        k("reputation"),
                                        k("kit"),
                                        k("racialEnemy"),
                                    ],
                                },
                            ],
                        },
                        { title: "Creature Flags", blocks: [{ kind: "flags", field: k("creatureFlags"), columns: 1 }] },
                        { title: "Status Flags", blocks: [{ kind: "flags", field: k("statusFlags"), columns: 1 }] },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Class & Alignment",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("class"),
                                        k("levelFirstClass"),
                                        k("levelSecondClass"),
                                        k("levelThirdClass"),
                                        k("race"),
                                        k("general"),
                                        k("specific"),
                                        k("alignment"),
                                        k("enemyAlly"),
                                    ],
                                },
                            ],
                        },
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
                            title: "Morale",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [k("morale"), k("moraleBreak"), k("moraleRecoveryTime"), k("luck")],
                                },
                            ],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Combat",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("thaco"),
                                        k("numAttacks"),
                                        k("acNatural"),
                                        k("acEffective"),
                                        k("acCrushingMod"),
                                        k("acMissileMod"),
                                        k("acPiercingMod"),
                                        k("acSlashingMod"),
                                        k("hideInShadows"),
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
                            title: "Skills",
                            blocks: [
                                {
                                    kind: "fields",
                                    columns: 2,
                                    fields: [
                                        k("detectIllusion"),
                                        k("setTraps"),
                                        k("lore"),
                                        k("lockpicking"),
                                        k("moveSilently"),
                                        k("findDisarmTraps"),
                                        k("pickPockets"),
                                        k("fatigue"),
                                        k("intoxication"),
                                    ],
                                },
                            ],
                        },
                    ],
                },
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
                            title: "Scripts",
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
    },
});
