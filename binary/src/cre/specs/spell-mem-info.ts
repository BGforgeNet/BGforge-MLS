// Hand-written from IESDP cre_v1.htm "CRE V1.0 Spell Memorization Info". 16 bytes.

import { u16, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const creSpellMemInfoSpec = {
    spellLevel: { codec: u16 },
    numMemorizable: { codec: u16 },
    numMemorizableEffective: { codec: u16 },
    spellType: { codec: u16 },
    firstMemorizedSpellIndex: { codec: u32 },
    memorizedSpellCount: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type CreSpellMemInfoData = SpecData<typeof creSpellMemInfoSpec>;
