/**
 * SPL declarative layout. Same shape as ITM (header fields + Abilities + Effects), rendered on a single
 * dense page instead of the legacy tabs. One variant ("spell"), stamped by the parser.
 *
 * Field refs are the SPL adapter's semantic keys (`spl.header.<camelCase>`, verified against the model).
 * Omitted (round-trip unaffected - serializer rebuilds from the model): signature/version magic, the many
 * reserved `unused*` padding fields, and the serializer-managed offset/count fields. The Effects detail
 * opcode renders as a searchable combobox (every enum does); being `enumOpen` it also accepts a custom
 * numeric value.
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
    labels: {
        ...featureBlockBodyLabels(SPL_EFFECTS_PREFIX),
        ...splAbilityBodyLabels(SPL_ABILITIES_PREFIX),
        // `sectype` humanizes to the unclear "Sectype"; it is the secondary type (msectype.2da).
        [k("sectype")]: "Secondary Type",
    },
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
                    // Abilities + effects as one two-level tree (effects nested under their owning ability;
                    // casting effects under "Global"). Replaces the former flat Abilities / Effects tabs. SPL
                    // ability rows show a "Level Required" badge (projectEffectTree reads it; ITM has none).
                    id: "tree",
                    label: "Abilities & Effects",
                    // Combined "abilities/effects" count badge (the model still has both groups, the tree just
                    // joins them), parallel to the spellbook tab's known/memorized pair.
                    countFromPair: ["Abilities", "Effects"],
                    rows: [
                        {
                            panels: [
                                {
                                    blocks: [
                                        {
                                            kind: "effectTree",
                                            abilityDetail: splAbilityBodyRows(SPL_ABILITIES_PREFIX),
                                            effectDetail: featureBlockBodyRows(SPL_EFFECTS_PREFIX),
                                            childSection: "Effects",
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
