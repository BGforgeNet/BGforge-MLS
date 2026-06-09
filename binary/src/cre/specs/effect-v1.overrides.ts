/**
 * Hand-written augmentation of `creEffectV1Spec` (CRE v0 / EFF v1 effects) with the shared IE opcode lookup,
 * mirroring `effectSpecAnnotated` (EFF v1 feature_block) and `effBodySpecAnnotated` (EFF v2 body) so the
 * opcode renders as a searchable combobox in every effect format, not a bare number field.
 *
 * Only `opcode` is annotated. The other v0 enum-candidate fields (target/timingMode/resistance/
 * savingThrowType) use byte-sized value spaces that differ from the v2 effect's and are not verified against
 * the v0 corpus, so they stay raw rather than risk a wrong lookup. The lookup is display-only: rebuild reads
 * each scalar from `rawValue` (the number), so the enum never affects the byte round-trip.
 */

import type { FieldSpec } from "../../spec/types";
import { Opcodes } from "../../ie-common/opcodes";
import { creEffectV1Spec } from "./effect-v1";

export const creEffectV1SpecAnnotated = {
    ...creEffectV1Spec,
    // Opcodes are open (mods add new ones; the engine accepts any value); the lookup is advisory display only.
    opcode: { ...creEffectV1Spec.opcode, enum: Opcodes, enumOpen: true, searchableEnum: true },
    // Trailing reserved dword: round-trips but carries no user value; hide it from the detail form like the
    // unused/padding fields of the EFF v2 effect (the rebuilder reads it back by label, so round-trip holds).
    unknown: { ...creEffectV1Spec.unknown, hidden: true },
} satisfies Record<string, FieldSpec>;
