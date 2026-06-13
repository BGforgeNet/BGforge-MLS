/**
 * Shared SPL ability (extended-header) layout, as reusable rows + label overrides parameterized by field-ref
 * prefix. A SPL ability renders these curated panels (at `spl.abilities[].`) instead of a generic auto-form,
 * so it reads as panels consistent with the effects beside it. Parallel to the ITM ability fragment
 * (`../itm/ability-layout.ts`): both lead with an "Ability" panel (activation + targeting) and a "Projectile"
 * panel; SPL is a spell header, so where ITM carries weapon damage/charges it carries a "Casting" panel
 * (level / casting time / uses per day) and a memorised-icon "Appearance" panel. Same titles and disposition
 * where the records align; different panels for the fields that genuinely differ.
 *
 * The reserved `unused*` slots are already hidden by the spec; the serializer-managed feature-block pointers
 * (`featureBlocksCount`/`featureBlocksOffset`) are omitted - derived from the ability's effects, not user data.
 */

import type { DetailRow } from "../layout-schema-types";

const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The SPL ability panels, emitted for any field-ref prefix. */
export function splAbilityBodyRows(prefix: string): DetailRow[] {
    const k = (key: string): string => refAt(prefix, key);
    return [
        {
            panels: [
                {
                    title: "Ability",
                    blocks: [
                        {
                            kind: "fields",
                            columns: 2,
                            fields: [k("form"), k("location"), k("target"), k("targetCount"), k("range")],
                        },
                        { kind: "flags", field: k("disposition"), columns: 1 },
                    ],
                },
                {
                    title: "Casting",
                    blocks: [{ kind: "fields", fields: [k("levelRequired"), k("castingTime"), k("timesPerDay")] }],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Projectile",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("projectile")] }],
                },
                {
                    title: "Appearance",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("memorisedIcon")] }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the SPL ability at a given prefix. The spec's parse-time presentation already
 *  names every panel field well, so there are currently none; kept for parity with the ITM fragment and so a
 *  future relabel has a home without re-wiring the layout. */
export function splAbilityBodyLabels(_prefix: string): Record<string, string> {
    return {};
}
