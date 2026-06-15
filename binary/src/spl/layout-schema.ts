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
                                    // Exclusion flags regrouped by who they bar, one subgroup per column: Priests
                                    // (alignment bits 0-5), Mages (specialist bits 6-14), and Class (the two
                                    // hybrid-class bits 30-31). The panel title carries "Exclude", so each checkbox
                                    // drops the redundant prefix (and its subgroup's category word). Display-only -
                                    // the backing field and its canonical SplExclusionFlags identity are unchanged
                                    // (labels here override only what the checkbox shows).
                                    title: "Exclude",
                                    // Hug the grouped content instead of stretching across the row it wraps onto.
                                    fit: true,
                                    blocks: [
                                        {
                                            kind: "flagGroups",
                                            columns: [
                                                [
                                                    {
                                                        label: "Priests",
                                                        items: [
                                                            { field: k("exclusionFlags"), mask: 0x1, label: "Chaotic" },
                                                            { field: k("exclusionFlags"), mask: 0x2, label: "Evil" },
                                                            { field: k("exclusionFlags"), mask: 0x4, label: "Good" },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x8,
                                                                label: "GE-Neutral",
                                                            },
                                                            { field: k("exclusionFlags"), mask: 0x10, label: "Lawful" },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x20,
                                                                label: "LC-Neutral",
                                                            },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Mages",
                                                        items: [
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x40,
                                                                label: "Abjurers",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x80,
                                                                label: "Conjurers",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x100,
                                                                label: "Diviners",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x200,
                                                                label: "Enchanters",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x400,
                                                                label: "Illusionists",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x800,
                                                                label: "Invokers",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x1000,
                                                                label: "Necromancers",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x2000,
                                                                label: "Transmuters",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x4000,
                                                                label: "Generalists (Wild Magic)",
                                                            },
                                                        ],
                                                    },
                                                ],
                                                [
                                                    {
                                                        label: "Class",
                                                        items: [
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x40000000,
                                                                label: "Cleric/Paladin",
                                                            },
                                                            {
                                                                field: k("exclusionFlags"),
                                                                mask: 0x80000000,
                                                                label: "Druid/Ranger",
                                                            },
                                                        ],
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
