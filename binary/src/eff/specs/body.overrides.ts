/**
 * Hand-written augmentation of `effBodySpec` with shared IE effect lookups.
 * EFF v2 body has the same semantic shape as feature_block (opcode + target
 * + timing + resistance + saveType) but uses wider field widths (mostly
 * dword instead of word/char). Lookup tables are number-keyed and work for
 * either wire type.
 */

import { i32 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";
import {
    EffectParentResourceFlags,
    EffectParentResourceType,
    EffectResistanceFlags,
    EffectSaveTypeFlags,
    EffectTarget,
    EffectTiming,
    Schools,
    SecondaryTypes,
} from "../../ie-common/types";
import { Opcodes } from "../../ie-common/opcodes";
import { effBodySpec } from "./body";

export const effBodySpecAnnotated = {
    ...effBodySpec,
    // Reserved padding and duplicated magic: real wire bytes that round-trip, but carry no value the user
    // edits. Hide them from the detail form (the rebuilder reads them back by label, so the byte round-trip is
    // unaffected). The standalone EFF layout already omits them by curation; this also hides them in the
    // uncurated CRE v2 effect detail, which dumps every field.
    signature2: { ...effBodySpec.signature2, hidden: true },
    version2: { ...effBodySpec.version2, hidden: true },
    unused1: { ...effBodySpec.unused1, hidden: true },
    unused2: { ...effBodySpec.unused2, hidden: true },
    unused3: { ...effBodySpec.unused3, hidden: true },
    unused4: { ...effBodySpec.unused4, hidden: true },
    unused5: { ...effBodySpec.unused5, hidden: true },
    unused6: { ...effBodySpec.unused6, hidden: true },
    unused7: { ...effBodySpec.unused7, hidden: true },
    // Open enums - the engine accepts any value for opcode/timing (the catalogs are advisory), so strict
    // canonical mode does not reject unrecognised values. See `ie-common/specs/effect.overrides.ts`.
    opcode: { ...effBodySpec.opcode, enum: Opcodes, enumOpen: true },
    target: { ...effBodySpec.target, enum: EffectTarget },
    timing: { ...effBodySpec.timing, enum: EffectTiming, enumOpen: true },
    resistance: { ...effBodySpec.resistance, flags: EffectResistanceFlags },
    saveType: { ...effBodySpec.saveType, flags: EffectSaveTypeFlags },
    // Primary type / magic school (mschool.2da) and secondary type (msectype.2da); both mod-extensible 2DAs,
    // shared with the SPL header and ITM ability fields of the same name.
    school: { ...effBodySpec.school, enum: Schools, enumOpen: true },
    sectype: { ...effBodySpec.sectype, enum: SecondaryTypes, enumOpen: true },
    // Parent resource kind (0 None / 1 Spell / 2 Item per IESDP eff_v2 0x90); was a raw integer next to the
    // parent-resource flags. Open: EE/mod data occasionally carries values outside the documented three.
    parentResourceType: { ...effBodySpec.parentResourceType, enum: EffectParentResourceType, enumOpen: true },
    // Bitfield (flags of the parent SPL); was rendering as a raw integer for want of a flag table.
    parentResourceFlags: { ...effBodySpec.parentResourceFlags, flags: EffectParentResourceFlags },
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

// Presentation overrides for the EFF body. `stackingIdTobex` (IESDP eff_v2 "Special", offset 0x48) packs a
// modder prefix in the high word and a unique id in the low word - IESDP's own example is hex (0x41360001),
// so decimal (1094123521) hides the structure. Display-only: the codec and wire bytes are unchanged. Shared
// by the display walk (eff/index.ts) and the path-keyed presentation schema so both render hex.
export const effBodyPresentation: StructPresentation<SpecData<typeof effBodySpecAnnotated>> = {
    stackingIdTobex: { format: "hex32" },
};
