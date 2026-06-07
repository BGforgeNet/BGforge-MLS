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

const k = (key: string): string => `spl.header.${key}`;

export const splLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "spl",
    maxContentWidthPx: 1180,
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
                                    title: "Exclusion",
                                    blocks: [{ kind: "flags", field: k("exclusionFlags"), columns: 1 }],
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
