/**
 * ITM declarative layout. Renders the item on a single dense page instead of the legacy Header / Abilities
 * / Effects tabs: header fields grouped into panels, then the Abilities and Effects arrays as master-detail
 * list blocks (each delegates to the shared ListSection via the windowed path - filtering, structure ops,
 * and the per-entry detail form all come for free). One variant ("item"), stamped by the parser.
 *
 * Field refs are the semantic keys the ITM adapter produces (`itm.header.<camelCase>`, verified against the
 * model). The four usability-flag bytes each have a distinct flag table (Class/Alignment, Class, Class/Race,
 * Race per IESDP) and a distinct semantic key (`itm.header.usabilityFlags.byteN...`), rendered as four flag
 * columns in the Usability panel. Omitted from the layout (round-trip is unaffected - the serializer rebuilds
 * from the model):
 *   - signature/version magic (constants);
 *   - the derived offset/count fields (extendedHeadersOffset/Count, featureBlocksOffset/Index/Count) which
 *     the serializer recomputes and the parser marks non-editable.
 *
 * The Effects detail form renders the ~300-entry opcode as a searchable combobox via the spec's
 * `searchableEnum` flag (it flows through to the FormSection-rendered detail field, not just layout blocks).
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";

const k = (key: string): string => `itm.header.${key}`;

export const itmLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "itm",
    maxContentWidthPx: 1180,
    variants: {
        item: {
            rows: [
                {
                    panels: [
                        {
                            title: "Identity",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [k("unidentifiedName"), k("identifiedName"), k("replacement"), k("type")],
                                },
                                { kind: "flags", field: k("flags"), columns: 1 },
                            ],
                        },
                        {
                            title: "Value & Lore",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("price"),
                                        k("weight"),
                                        k("stackAmount"),
                                        k("enchantment"),
                                        k("loreToId"),
                                    ],
                                },
                            ],
                        },
                        {
                            title: "Appearance & Text",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("inventoryIcon"),
                                        k("groundIcon"),
                                        k("descriptionIcon"),
                                        k("animation"),
                                        k("unidentifiedDesc"),
                                        k("identifiedDesc"),
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Requirements",
                            blocks: [
                                {
                                    kind: "fields",
                                    columns: 2,
                                    fields: [
                                        k("minLevel"),
                                        k("weaponProficiency"),
                                        k("minStrength"),
                                        k("minStrengthBonus"),
                                        k("minIntelligence"),
                                        k("minDexterity"),
                                        k("minWisdom"),
                                        k("minConstitution"),
                                        k("minCharisma"),
                                        k("kitUsability1"),
                                        k("kitUsability2"),
                                        k("kitUsability3"),
                                        k("kitUsability4"),
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Usability",
                            blocks: [
                                { kind: "flags", field: k("usabilityFlags.byte1ClassAlignment"), columns: 1 },
                                { kind: "flags", field: k("usabilityFlags.byte2Class"), columns: 1 },
                                { kind: "flags", field: k("usabilityFlags.byte3ClassRace"), columns: 1 },
                                { kind: "flags", field: k("usabilityFlags.byte4Race"), columns: 1 },
                            ],
                        },
                    ],
                },
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
                                },
                            ],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Effects",
                            blocks: [{ kind: "list", sectionKey: "Effects", render: "master-detail", canModify: true }],
                        },
                    ],
                },
            ],
        },
    },
});
