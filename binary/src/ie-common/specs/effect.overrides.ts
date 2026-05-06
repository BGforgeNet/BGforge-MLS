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
    // Opcodes are open: IESDP catalogs ~370 known ones but mods can introduce
    // new opcode numbers and the engine accepts any 16-bit value. The lookup
    // is advisory (display only); strict canonical mode does not reject
    // unrecognised opcodes.
    opcode: { ...effectSpec.opcode, enum: Opcodes, enumOpen: true },
    target: { ...effectSpec.target, enum: EffectTarget },
    // Timing has gaps (10 + 4096); mods occasionally use other values.
    timing: { ...effectSpec.timing, enum: EffectTiming, enumOpen: true },
    resistance: { ...effectSpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effectSpec.saveType, flags: EffectSaveTypeFlags },
} satisfies Record<string, FieldSpec>;
