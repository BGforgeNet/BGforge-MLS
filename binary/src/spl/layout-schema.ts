/**
 * SPL declarative layout. Same shape as ITM (header fields + Abilities + Effects), rendered on a single
 * dense page instead of the legacy tabs. One variant ("spell"), stamped by the parser.
 *
 * Field refs are the SPL adapter's semantic keys (`spl.header.<camelCase>`, verified against the model).
 * Omitted (round-trip unaffected - serializer rebuilds from the model): signature/version magic, the many
 * reserved `unused*` padding fields, and the serializer-managed offset/count fields. The Effects detail
 * opcode renders as a searchable combobox via the spec's `searchableEnum` flag.
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";
import { featureBlockBodyLabels, featureBlockBodyRows } from "../ie-common/feature-block-layout";
import { splAbilityBodyLabels, splAbilityBodyRows } from "./ability-layout";

const k = (key: string): string => `spl.header.${key}`;

// SPL Effects are 48-byte feature blocks; render them through the shared fragment (same as ITM, parallel to
// the EFF v2 body) at the per-entry `spl.effects[]` prefix, instead of a generic auto-form.
const SPL_EFFECTS_PREFIX = "spl.effects[]";
// SPL Abilities render through the shared ability fragment (parallel to ITM abilities), curated panels rather
// than a flat auto-form.
const SPL_ABILITIES_PREFIX = "spl.abilities[]";

export const splLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "spl",
    maxContentWidthPx: 1180,
    labels: { ...featureBlockBodyLabels(SPL_EFFECTS_PREFIX), ...splAbilityBodyLabels(SPL_ABILITIES_PREFIX) },
    variants: {
        spell: {
            tabs: [
                {
                    id: "general",
                    label: "General",
                    rows: [
                        {
                            panels: [
                                {
                                    title: "Spell",
                                    blocks: [
                                        {
                                            kind: "fields",
                                            columns: 2,
                                            fields: [
                                                k("unidentifiedName"),
                                                k("description"),
                                                k("type"),
                                                k("level"),
                                                k("school"),
                                                k("sectype"),
                                                k("castingGraphics"),
                                                k("completionSound"),
                                                k("spellbookIcon"),
                                            ],
                                        },
                                    ],
                                },
                                { title: "Flags", blocks: [{ kind: "flags", field: k("flags"), columns: 1 }] },
                                {
                                    // 22 exclusion bits: two columns halve the height so the panel doesn't
                                    // tower over the Spell/Flags panels beside it.
                                    title: "Exclusion",
                                    blocks: [{ kind: "flags", field: k("exclusionFlags"), columns: 2 }],
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
                                            detailVariant: splAbilityBodyRows(SPL_ABILITIES_PREFIX),
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
                                            detailVariant: featureBlockBodyRows(SPL_EFFECTS_PREFIX),
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
