/**
 * ITM declarative layout. Renders the item on a single dense page instead of the legacy Header / Abilities
 * / Effects tabs: header fields grouped into panels, then the Abilities and Effects arrays as master-detail
 * list blocks (each delegates to the shared ListSection via the windowed path - filtering, structure ops,
 * and the per-entry detail form all come for free). One variant ("item"), stamped by the parser.
 *
 * Field refs are the semantic keys the ITM adapter produces (`itm.header.<camelCase>`, verified against the
 * model). The four usability bytes and four kit bytes are regrouped by semantic category in the "Unusable By"
 * (Alignment / Class / Race) and "Unusable By Kit" (one subgroup per base class) panels via the `flagGroups`
 * block - a category's bits cross the byte boundaries, so each checkbox names its own byte field + mask. The
 * IESDP "Usability" bytes are exclusion masks (a set bit forbids that class/race/kit), so the panels are titled
 * by effect. Omitted from the layout (round-trip is unaffected - the serializer rebuilds
 * from the model):
 *   - signature/version magic (constants);
 *   - the derived offset/count fields (extendedHeadersOffset/Count, featureBlocksOffset/Index/Count) which
 *     the serializer recomputes and the parser marks non-editable.
 *
 * The Effects detail form renders the ~300-entry opcode as a searchable combobox via the spec's
 * `searchableEnum` flag (it flows through to the FormSection-rendered detail field, not just layout blocks).
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";
import { featureBlockBodyLabels, featureBlockBodyRows } from "../ie-common/feature-block-layout";
import { itmAbilityBodyLabels, itmAbilityBodyRows } from "./ability-layout";

// ITM Effects are 48-byte feature blocks; render them through the shared fragment (parallel to the EFF v2
// body and to SPL effects) so an effect reads the same wherever it appears, at the per-entry `itm.effects[]`
// prefix - instead of a generic auto-form.
const ITM_EFFECTS_PREFIX = "itm.effects[]";
// ITM Abilities render through the shared ability fragment (parallel to SPL abilities), so an ability reads
// as curated panels consistent with the effects beside it instead of a flat auto-form.
const ITM_ABILITIES_PREFIX = "itm.abilities[]";

const k = (key: string): string => `itm.header.${key}`;

// The four usability bytes and four kit bytes (each a distinct bitfield). The "Unusable By" and "Unusable By
// Kit" panels regroup these bits by semantic category (alignment/class/race; base class) - groupings that
// cross byte boundaries - so the flagGroups items below reference these byte fields with explicit masks.
const uAlign = k("usabilityFlags.byte1ClassAlignment"); // alignment bits + Bard/Cleric
const uClass2 = k("usabilityFlags.byte2Class");
const uClass3 = k("usabilityFlags.byte3ClassRace"); // classes + Elf
const uRace4 = k("usabilityFlags.byte4Race"); // races + Monk/Druid
const kit1 = k("kitUsability1");
const kit2 = k("kitUsability2");
const kit3 = k("kitUsability3");
const kit4 = k("kitUsability4");

/** Display-label overrides (see `FormatLayout.labels`) - expand "Desc" and fix the "Id" casing. The four
 *  usability bytes and four kit bytes carry no field-row labels: they render only as `flagGroups` checkboxes
 *  (regrouped by category across bytes - see the "Unusable By" / "Unusable By Kit" panels), where the group
 *  legends and per-item labels live on the block, not on the byte field. */
const itmLabels: Record<string, string> = {
    [k("unidentifiedDesc")]: "Unidentified Description",
    [k("identifiedDesc")]: "Identified Description",
    [k("loreToId")]: "Lore to ID",
    // These sit under the "Requirements" panel (minimum stat requirements), so the stat labels drop the "min".
    [k("minLevel")]: "Level",
    [k("minStrength")]: "Strength",
    [k("minStrengthBonus")]: "Strength Bonus",
    [k("minIntelligence")]: "Intelligence",
    [k("minDexterity")]: "Dexterity",
    [k("minWisdom")]: "Wisdom",
    [k("minConstitution")]: "Constitution",
    [k("minCharisma")]: "Charisma",
    // Effect feature-block labels, shared with SPL and parallel to the EFF v2 fragment.
    ...featureBlockBodyLabels(ITM_EFFECTS_PREFIX),
    // Ability panel labels (short names inside the boxed Alternative / Ammo Type groups).
    ...itmAbilityBodyLabels(ITM_ABILITIES_PREFIX),
};

export const itmLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "itm",
    maxContentWidthPx: 1180,
    labels: itmLabels,
    variants: {
        item: {
            tabs: [
                {
                    id: "general",
                    label: "General",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Main",
                                    // The former Identity + Value & Lore plus the descriptions/animation/
                                    // proficiency, all in one panel. Scalars in wire (spec) order as far as the
                                    // layout allows; the flags bitfield (wire-adjacent to `replacement`) renders
                                    // as its own checkbox block beside the scalars rather than interleaved.
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("unidentifiedName"),
                                                k("identifiedName"),
                                                k("replacement"),
                                                k("type"),
                                                k("weaponProficiency"),
                                                k("price"),
                                                k("stackAmount"),
                                                k("loreToId"),
                                                k("weight"),
                                                k("unidentifiedDesc"),
                                                k("identifiedDesc"),
                                                k("enchantment"),
                                            ],
                                        },
                                        { kind: "flags", field: k("flags"), columns: 2 },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Appearance",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            fields: [
                                                k("animation"),
                                                k("inventoryIcon"),
                                                k("groundIcon"),
                                                k("descriptionIcon"),
                                            ],
                                        },
                                    ],
                                },
                                {
                                    // Title carries the shared "Min" qualifier, so each item label drops it.
                                    title: "Requirements",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("minLevel"),
                                                k("minStrength"),
                                                k("minStrengthBonus"),
                                                k("minIntelligence"),
                                                k("minDexterity"),
                                                k("minWisdom"),
                                                k("minConstitution"),
                                                k("minCharisma"),
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                        {
                            panels: [
                                {
                                    title: "Unusable By",
                                    // Alignment / Class / Race, one subgroup per column. A category's bits are
                                    // split across the four usability bytes, so each item names its own byte +
                                    // mask; default labels come from the byte's flag table. Order preserved
                                    // byte-then-bit within each column.
                                    blocks: [
                                        {
                                            kind: "flagGroups",
                                            bulkSelect: true,
                                            columns: [
                                                [
                                                    {
                                                        label: "Alignment",
                                                        items: [
                                                            { field: uAlign, mask: 0x01 },
                                                            { field: uAlign, mask: 0x02 },
                                                            { field: uAlign, mask: 0x04 },
                                                            { field: uAlign, mask: 0x08 },
                                                            { field: uAlign, mask: 0x10 },
                                                            { field: uAlign, mask: 0x20 },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Class",
                                                        // 19 class flags - split into 3 sub-columns so the box
                                                        // height balances the short Alignment/Race columns.
                                                        columns: 3,
                                                        items: [
                                                            { field: uAlign, mask: 0x40 }, // Bard
                                                            { field: uAlign, mask: 0x80 }, // Cleric
                                                            { field: uClass2, mask: 0x01 },
                                                            { field: uClass2, mask: 0x02 },
                                                            { field: uClass2, mask: 0x04 },
                                                            { field: uClass2, mask: 0x08 },
                                                            { field: uClass2, mask: 0x10 },
                                                            { field: uClass2, mask: 0x20 },
                                                            { field: uClass2, mask: 0x40 },
                                                            { field: uClass2, mask: 0x80 },
                                                            { field: uClass3, mask: 0x01 },
                                                            { field: uClass3, mask: 0x02 },
                                                            { field: uClass3, mask: 0x04 },
                                                            { field: uClass3, mask: 0x08 },
                                                            { field: uClass3, mask: 0x10 },
                                                            { field: uClass3, mask: 0x20 },
                                                            { field: uClass3, mask: 0x40 },
                                                            { field: uRace4, mask: 0x20 }, // Monk
                                                            { field: uRace4, mask: 0x40 }, // Druid / Shaman
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Race",
                                                        items: [
                                                            { field: uClass3, mask: 0x80 }, // Elf
                                                            { field: uRace4, mask: 0x01 },
                                                            { field: uRace4, mask: 0x02 },
                                                            { field: uRace4, mask: 0x04 },
                                                            { field: uRace4, mask: 0x08 },
                                                            { field: uRace4, mask: 0x10 },
                                                            { field: uRace4, mask: 0x80 },
                                                        ],
                                                    },
                                                ],
                                            ],
                                        },
                                    ],
                                },
                                {
                                    title: "Unusable By Kit",
                                    // Kits grouped under their base class; a class's kits span several kit bytes,
                                    // so each item names its byte + mask. Short labels drop the redundant class
                                    // word ("Cleric of Talos" -> "Talos") since the subgroup legend carries it.
                                    blocks: [
                                        {
                                            kind: "flagGroups",
                                            bulkSelect: true,
                                            columns: [
                                                [
                                                    {
                                                        label: "Cleric",
                                                        items: [
                                                            { field: kit1, mask: 0x01, label: "Talos" },
                                                            { field: kit1, mask: 0x02, label: "Helm" },
                                                            { field: kit1, mask: 0x04, label: "Lathander" },
                                                        ],
                                                    },
                                                    {
                                                        label: "Druid",
                                                        items: [
                                                            { field: kit1, mask: 0x08, label: "Totemic" },
                                                            { field: kit1, mask: 0x10, label: "Shapeshifter" },
                                                            { field: kit1, mask: 0x20, label: "Avenger" },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Fighter",
                                                        items: [
                                                            { field: kit1, mask: 0x40, label: "Barbarian" },
                                                            { field: kit4, mask: 0x01, label: "Berserker" },
                                                            { field: kit4, mask: 0x02, label: "Wizard Slayer" },
                                                            { field: kit4, mask: 0x04, label: "Kensai" },
                                                        ],
                                                    },
                                                    {
                                                        label: "Paladin",
                                                        items: [
                                                            { field: kit4, mask: 0x08, label: "Cavalier" },
                                                            { field: kit4, mask: 0x10, label: "Inquisitor" },
                                                            { field: kit4, mask: 0x20, label: "Undead Hunter" },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Mage",
                                                        items: [
                                                            { field: kit1, mask: 0x80, label: "Wild Mage" },
                                                            { field: kit3, mask: 0x01, label: "Diviner" },
                                                            { field: kit3, mask: 0x02, label: "Enchanter" },
                                                            { field: kit3, mask: 0x04, label: "Illusionist" },
                                                            { field: kit3, mask: 0x08, label: "Invoker" },
                                                            { field: kit3, mask: 0x10, label: "Necromancer" },
                                                            { field: kit3, mask: 0x20, label: "Transmuter" },
                                                            { field: kit4, mask: 0x40, label: "Abjurer" },
                                                            { field: kit4, mask: 0x80, label: "Conjurer" },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Ranger",
                                                        items: [
                                                            { field: kit2, mask: 0x01, label: "Stalker" },
                                                            { field: kit2, mask: 0x02, label: "Beastmaster" },
                                                            { field: kit3, mask: 0x80, label: "Feralan" },
                                                        ],
                                                    },
                                                    {
                                                        label: "Thief",
                                                        items: [
                                                            { field: kit2, mask: 0x04, label: "Assassin" },
                                                            { field: kit2, mask: 0x08, label: "Bounty Hunter" },
                                                            { field: kit2, mask: 0x10, label: "Swashbuckler" },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Bard",
                                                        items: [
                                                            { field: kit2, mask: 0x20, label: "Blade" },
                                                            { field: kit2, mask: 0x40, label: "Jester" },
                                                            { field: kit2, mask: 0x80, label: "Skald" },
                                                        ],
                                                    },
                                                    {
                                                        label: "Other",
                                                        items: [{ field: kit3, mask: 0x40, label: "All (no kit)" }],
                                                    },
                                                ],
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    id: "abilities",
                    label: "Abilities",
                    countFrom: "Abilities",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Abilities",
                                    blocks: [
                                        {
                                            kind: "list",
                                            sectionKey: "Abilities",
                                            render: "master-detail",
                                            canAdd: true,
                                            canModify: true,
                                            childAddSection: "Effects",
                                            detailVariant: itmAbilityBodyRows(ITM_ABILITIES_PREFIX),
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
                                            detailVariant: featureBlockBodyRows(ITM_EFFECTS_PREFIX),
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
