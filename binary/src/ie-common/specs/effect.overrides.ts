/**
 * Hand-written augmentation of `effectSpec` with shared IE effect lookups.
 * The opcode lookup is generated from IESDP `_opcodes/op*.html` and lives
 * in `../opcodes.ts`.
 */

import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import { EFFECT_RESOURCE_REF, EffectResistanceFlags, EffectSaveTypeFlags, EffectTarget, EffectTiming } from "../types";
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
    // Same deferral as the EFF v2 body's resrefs - the opcode picks the target type. Shared so ITM, SPL and
    // CRE effects, which all render through this record, cannot disagree about it.
    resource: { ...effectSpec.resource, ref: EFFECT_RESOURCE_REF },
} satisfies Record<string, FieldSpec>;

// Single shared presentation for the feature-block / EFF v1 record. This is the same 48 bytes embedded by
// ITM, SPL, and CRE (effStructureVersion 0), walked and schema-derived at five sites; declaring the table here
// (next to the shared spec, mirroring eff `effBodyPresentation`) means a future format/enum override is added
// once and every consumer renders the record identically, rather than re-declaring `{}` per site and drifting.
// Empty today - the enum/flag typing lives on the spec above; this carries only `format`/`domain` overrides.
export const effectPresentation: StructPresentation<SpecData<typeof effectSpecAnnotated>> = {};
