/**
 * EFF declarative layout. EFF v2 is a single standalone effect (8-byte header + 264-byte body), so the
 * editor renders it as one dense page via the generic layout renderer instead of the legacy Header/Body
 * tabs. One variant ("effect"), stamped by the parser.
 *
 * Field refs are the semantic keys the EFF adapter produces for the body fields (`eff.body.<camelCase>`,
 * verified against the model). The two signature/version magic fields (header and body) and the reserved
 * padding (`unused1`..`unused7`) are intentionally omitted - they are constants/padding, not user data;
 * leaving them out of the layout does not affect round-trip (the serializer rebuilds from the model). The
 * ~300-entry `opcode` enum renders as a searchable combobox via the spec's `searchableEnum` flag.
 */

import { formatLayoutSchema, type FormatLayout } from "../layout-schema-types";

/** Semantic key for an EFF body field. */
const k = (key: string): string => `eff.body.${key}`;

export const effLayout: FormatLayout = formatLayoutSchema.parse({
    schemaVersion: 1,
    format: "eff",
    maxContentWidthPx: 1000,
    variants: {
        effect: {
            rows: [
                {
                    panels: [
                        {
                            title: "Effect",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("opcode"),
                                        k("target"),
                                        k("power"),
                                        k("timing"),
                                        k("duration"),
                                        k("probability1"),
                                        k("probability2"),
                                    ],
                                },
                            ],
                        },
                        {
                            title: "Dice & Save",
                            blocks: [
                                { kind: "fields", fields: [k("diceThrown"), k("diceSides"), k("saveBonus")] },
                                { kind: "flags", field: k("saveType"), columns: 1 },
                            ],
                        },
                        {
                            title: "Resistance",
                            blocks: [{ kind: "flags", field: k("resistance"), columns: 1 }],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Parameters",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("parameter1"),
                                        k("parameter2"),
                                        k("parameter3"),
                                        k("parameter4"),
                                        k("parameter5"),
                                    ],
                                },
                            ],
                        },
                        {
                            title: "Resources",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("resource"),
                                        k("resource2"),
                                        k("resource3"),
                                        k("variableName"),
                                        k("school"),
                                        k("sectype"),
                                        k("stackingIdTobex"),
                                    ],
                                },
                            ],
                        },
                    ],
                },
                {
                    panels: [
                        {
                            title: "Caster & Projectile",
                            blocks: [
                                {
                                    kind: "fields",
                                    fields: [
                                        k("casterLevel"),
                                        k("casterXCoord"),
                                        k("casterYCoord"),
                                        k("targetXCoord"),
                                        k("targetYCoord"),
                                        k("parentResourceType"),
                                        k("parentResource"),
                                        k("parentResourceFlags"),
                                        k("projectile"),
                                        k("timeApplied"),
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
