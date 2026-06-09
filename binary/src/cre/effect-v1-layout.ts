/**
 * Shared CRE EFF v1 (48-byte) effect-body layout, as reusable rows + label overrides parameterized by field-ref
 * prefix. A CRE whose `effStructureVersion` is 0 embeds the older EFF v1 record (`specs/effect-v1.ts`) instead
 * of the EFF v2 body; those effects render these curated panels (at the same `cre.effects[].v2.` prefix the CRE
 * adapter routes BOTH effect versions through) rather than a generic auto-form.
 *
 * Parallel-not-identical to the EFF v2 fragment (`../eff/effect-body-layout.ts`): same panel titles and
 * disposition where the records align (Effect / Dice & Save / Parameters / Resources), but EFF v1 is a smaller,
 * DISTINCT record - it has no Caster & Projectile block and no School/Sectype classification, its save type is a
 * raw value rather than the v2 flags field, and it carries `timingMode`/`resref`/`savingThrowType`/
 * `savingThrowBonus` where v2 carries `timing`/`resource`/`saveType`/`saveBonus`. So this is a sibling fragment,
 * not the v2 one reused (see the binary-editor uniform-shared-layout principle: similar record -> parallel one).
 * It is wired as the FALLBACK variant on the CRE Effects list: the v2 fragment is tried first and declines a v1
 * entry (its v2-only refs are absent), so the v1 fragment renders.
 */

import type { DetailRow } from "../layout-schema-types";

const refAt = (prefix: string, key: string): string => `${prefix}.${key}`;

/** The EFF v1 body panels, emitted for any field-ref prefix. `parameter1`/`parameter2` are referenced by key
 *  (the opcode overlay relabels them per opcode, same as the v2 fragment); the reserved `unknown` dword is
 *  omitted (the serializer rebuilds it from the model). */
export function creEffectV1BodyRows(prefix: string): DetailRow[] {
    const k = (key: string): string => refAt(prefix, key);
    return [
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
                                k("timingMode"),
                                k("duration"),
                                k("probability1"),
                                k("probability2"),
                            ],
                        },
                    ],
                },
                {
                    // v1 carries dice plus a raw saving-throw type/bonus (the v2 fragment's Save Type is a flags
                    // field; v1's is a plain value, so it sits inline with the other fields rather than as flags).
                    title: "Dice & Save",
                    blocks: [
                        {
                            kind: "fields",
                            fields: [k("diceThrown"), k("diceSides"), k("savingThrowType"), k("savingThrowBonus")],
                        },
                    ],
                },
            ],
        },
        {
            panels: [
                {
                    title: "Parameters",
                    blocks: [{ kind: "fields", fields: [k("parameter1"), k("parameter2")] }],
                },
                {
                    title: "Resources",
                    blocks: [{ kind: "fields", fields: [k("resref")] }],
                },
                {
                    title: "Resistance",
                    fit: true,
                    blocks: [{ kind: "fields", fields: [k("resistance")] }],
                },
            ],
        },
    ];
}

/** Display-label overrides for the EFF v1 body at a given prefix - name the resref slot "Resource" so it reads
 *  identically to the v2 fragment's Resources panel. */
export function creEffectV1BodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => refAt(prefix, key);
    return {
        [k("resref")]: "Resource",
    };
}
