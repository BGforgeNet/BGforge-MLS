/**
 * Hand-written augmentation of `effectSpec` with shared IE effect lookups.
 * The opcode lookup is generated from IESDP `_opcodes/op*.html` and lives
 * in `../opcodes.ts`.
 */

import type { FieldSpec } from "../../spec/types";
import { EffectResistanceFlags, EffectSaveTypeFlags, EffectTarget, EffectTiming } from "../types";
import { effectSpec } from "./effect";
import { Opcodes } from "../opcodes";

export const effectSpecAnnotated = {
    ...effectSpec,
    opcode: { ...effectSpec.opcode, enum: Opcodes },
    target: { ...effectSpec.target, enum: EffectTarget },
    timing: { ...effectSpec.timing, enum: EffectTiming },
    resistance: { ...effectSpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effectSpec.saveType, flags: EffectSaveTypeFlags },
} satisfies Record<string, FieldSpec>;
