// Hand-written from IESDP cre_v1.htm "CRE V1.0 Known Spells". 12 bytes per record.

import { u16 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const creKnownSpellSpec = {
    spell: charsSpec(8),
    spellLevel: { codec: u16 },
    spellType: { codec: u16 },
} satisfies Record<string, FieldSpec>;

export type CreKnownSpellData = SpecData<typeof creKnownSpellSpec>;
