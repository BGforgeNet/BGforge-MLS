// Hand-written from IESDP cre_v1.htm "CRE V1.0 Memorized Spells Table". 12 bytes.

import { u32 } from "typed-binary";
import { charsSpec, type FieldSpec, type SpecData } from "../../spec/types";

export const creMemorizedSpellSpec = {
    spell: { ...charsSpec(8), ref: { kind: "resource", type: "SPL" } },
    memorizedFlags: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type CreMemorizedSpellData = SpecData<typeof creMemorizedSpellSpec>;
