/**
 * Hand-written augmentation of `effBodySpec` with shared IE effect lookups.
 * EFF v2 body has the same semantic shape as feature_block (opcode + target
 * + timing + resistance + saveType) but uses wider field widths (mostly
 * dword instead of word/char). Lookup tables are number-keyed and work for
 * either wire type.
 */

import { i32 } from "typed-binary";
import { charsSpec, type FieldSpec } from "../../spec/types";
import { EffectResistanceFlags, EffectSaveTypeFlags, EffectTarget, EffectTiming } from "../../ie-common/types";
import { Opcodes } from "../../ie-common/opcodes";
import { effBodySpec } from "./body";

export const effBodySpecAnnotated = {
    ...effBodySpec,
    // Open enums - mods can extend opcodes and timing modes; strict canonical
    // mode does not reject unrecognised values. See `ie-common/specs/effect.overrides.ts`.
    opcode: { ...effBodySpec.opcode, enum: Opcodes, enumOpen: true, searchableEnum: true },
    target: { ...effBodySpec.target, enum: EffectTarget },
    timing: { ...effBodySpec.timing, enum: EffectTiming, enumOpen: true },
    resistance: { ...effBodySpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effBodySpec.saveType, flags: EffectSaveTypeFlags },
    // Caster/target coordinates are signed: -1 is a real engine value ("no/origin coordinate"), and
    // negative map coordinates occur. IESDP types them `dword` and has no signed-integer type, so the
    // generator emits u32 (surfacing -1 as 4294967295). Override to i32 here until IESDP/the generator gain
    // a signed-dword type; wire bytes are unchanged (i32 and u32 read/write the same 4 bytes), so this is a
    // lossless display/type correction, not a wire change.
    casterXCoord: { ...effBodySpec.casterXCoord, codec: i32 },
    casterYCoord: { ...effBodySpec.casterYCoord, codec: i32 },
    targetXCoord: { ...effBodySpec.targetXCoord, codec: i32 },
    targetYCoord: { ...effBodySpec.targetYCoord, codec: i32 },
    // `variableName` is the per-effect local-variable name used by the variable-related opcodes (set/inc/
    // check global or local). IESDP types it as `bytes, length: 32`, but for those opcodes it holds a
    // NUL-terminated ASCII identifier; surface it as a string so the editor renders the name directly
    // instead of "(32 values) padding". `charsSpec` keeps the wire round-trip byte-identical (NUL-pad on
    // write, NUL-strip on display), so reinterpreting an unused/empty field is lossless.
    //
    // Evidence note: across all 85 EFF fixtures under external/ the field is empty (32 NUL bytes) - none
    // exercise a variable opcode, so the corpus neither confirms nor refutes the string semantics. We keep
    // the string interpretation because (a) it matches the engine's documented use of this field for the
    // variable opcodes and (b) it is lossless for the empty case the fixtures do cover. If a populated
    // fixture later shows non-NUL non-ASCII bytes here, revisit.
    variableName: charsSpec(32),
} satisfies Record<string, FieldSpec>;
