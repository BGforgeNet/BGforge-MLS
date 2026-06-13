/**
 * CRE EFF v1 (48-byte) effect-body layout: the field order + label overrides for the shared effect-layout
 * builder. A CRE whose `effStructureVersion` is 0 embeds the older EFF v1 record (`specs/effect-v1.ts`) instead
 * of the EFF v2 body; those effects render through `effectBodyRows` at the same `cre.effects[].v2.` prefix the
 * CRE adapter routes BOTH effect versions through.
 *
 * Fields are listed in on-disk (wire) byte order - the same order as `specs/effect-v1.ts`, top to bottom. EFF
 * v1 is a smaller, DISTINCT record from EFF v2 (no caster/projectile block, no school/sectype, and it carries
 * `timingMode`/`resref`/`savingThrowType`/`savingThrowBonus` where v2 carries
 * `timing`/`resource`/`saveType`/`saveBonus`), so it passes its own field list. Its `resistance`/
 * `savingThrowType` are plain byte/dword values with no flag table (unlike the v2 / feature-block bitfields), so
 * they are plain fields, not flag boxes. It is wired as the FALLBACK variant on the CRE Effects list: the v2
 * fragment is tried first and declines a v1 entry (its v2-only refs are absent), so this renders. The reserved
 * `unknown` dword is omitted (the serializer rebuilds it from the model).
 */

import { effectBodyRows, PROBABILITY_JOIN, type EffectLayoutField } from "../ie-common/effect-layout";
import type { DetailRow } from "../layout-schema-types";

/** EFF v1 body fields in wire byte order. No `{ flags }` entries: v1's `resistance`/`savingThrowType` are plain
 *  values, not bitfields. */
const EFF_V1_FIELDS: readonly EffectLayoutField[] = [
    "opcode",
    "target",
    "power",
    "parameter1",
    "parameter2",
    "timingMode",
    "resistance",
    "duration",
    "probability1",
    "probability2",
    "resref",
    "diceThrown",
    "diceSides",
    "savingThrowType",
    "savingThrowBonus",
];

/** The EFF v1 body rows for any field-ref prefix. */
export function creEffectV1BodyRows(prefix: string): DetailRow[] {
    return effectBodyRows(prefix, EFF_V1_FIELDS, [PROBABILITY_JOIN]);
}

/** Display-label overrides for the EFF v1 body at a given prefix - name the resref slot "Resource" so it reads
 *  the same as the v2 body's resource field. */
export function creEffectV1BodyLabels(prefix: string): Record<string, string> {
    const k = (key: string): string => `${prefix}.${key}`;
    return {
        [k("resref")]: "Resource",
        // The 0x1c/0x20 pair is spec-named diceThrown/diceSides, but most opcodes read it as a Maximum/Minimum
        // Level range; that is the default label. The opcode overlay (binary-editor ie-effects) flips it to
        // "Dice Thrown"/"Dice Sides" for the dice opcodes (12/17/18/331/333, 218 when param2=1).
        [k("diceThrown")]: "Maximum Level",
        [k("diceSides")]: "Minimum Level",
    };
}
