/**
 * Hand-written augmentation of `effBodySpec` with shared IE effect lookups.
 * EFF v2 body has the same semantic shape as feature_block (opcode + target
 * + timing + resistance + saveType) but uses wider field widths (mostly
 * dword instead of word/char). Lookup tables are number-keyed and work for
 * either wire type.
 */

import type { FieldSpec } from "../../spec/types";
import { EffectResistanceFlags, EffectSaveTypeFlags, EffectTarget, EffectTiming } from "../../ie-common/types";
import { Opcodes } from "../../ie-common/opcodes";
import { effBodySpec } from "./body";

export const effBodySpecAnnotated = {
    ...effBodySpec,
    opcode: { ...effBodySpec.opcode, enum: Opcodes },
    target: { ...effBodySpec.target, enum: EffectTarget },
    timing: { ...effBodySpec.timing, enum: EffectTiming },
    resistance: { ...effBodySpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effBodySpec.saveType, flags: EffectSaveTypeFlags },
} satisfies Record<string, FieldSpec>;
