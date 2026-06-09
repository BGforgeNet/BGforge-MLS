// Hand-written from IESDP _data/file_formats/eff_v1/header.yml (48 bytes / 0x30).
//
// EFF v1 is the pre-BG2 effect record layout. A CRE embeds it inline only when its header byte 0x33
// (`effStructureVersion`) is 0; when 0x33 is 1 the CRE embeds the larger EFF v2 body instead (264 bytes /
// 0x108, `../../eff/specs/body`, the same record a standalone `.eff` file holds). So this spec is consumed
// only via the parser's dispatch on `effStructureVersion`.
//
// NB: this is NOT the ITM/SPL effect format. ITM/SPL embed their own 48-byte feature block
// (`ie-common/specs/effect`) - same size as EFF v1 but a distinct layout - and never carry an EFF v2 body.

import { u16, u32, u8 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const creEffectV1Spec = {
    opcode: { codec: u16 },
    target: { codec: u8 },
    power: { codec: u8 },
    parameter1: { codec: u32 },
    parameter2: { codec: u32 },
    timingMode: { codec: u8 },
    resistance: { codec: u8 },
    duration: { codec: u32 },
    probability1: { codec: u8 },
    probability2: { codec: u8 },
    resref: charsSpec(8),
    diceThrown: { codec: u32 },
    diceSides: { codec: u32 },
    savingThrowType: { codec: u32 },
    savingThrowBonus: { codec: u32 },
    unknown: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type CreEffectV1Data = SpecData<typeof creEffectV1Spec>;
