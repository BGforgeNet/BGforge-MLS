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
    // Opcodes are open: IESDP catalogs ~370 known ones but the engine accepts any 16-bit value, so the lookup
    // is advisory (display only) and strict canonical mode does not reject unrecognised opcodes. (The engine's
    // opcode set is fixed - mods do not add new opcodes - but an out-of-range value still round-trips.)
    opcode: { ...effectSpec.opcode, enum: Opcodes, enumOpen: true },
    target: { ...effectSpec.target, enum: EffectTarget },
    // Timing has gaps (10 + 4096); out-of-range values still round-trip, so the enum is advisory.
    timing: { ...effectSpec.timing, enum: EffectTiming, enumOpen: true },
    resistance: { ...effectSpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effectSpec.saveType, flags: EffectSaveTypeFlags },
} satisfies Record<string, FieldSpec>;
