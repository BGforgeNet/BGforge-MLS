// Hand-written from IESDP dlg_v1.htm. The state-trigger, transition-trigger and action tables share this
// 8-byte shape: an (offset, length) pair into a trailing text block. The strings it points at are NOT
// zero-terminated, so length is the only terminator.

import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const dlgTextRefSpec = {
    offset: { codec: u32 },
    length: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type DlgTextRefData = SpecData<typeof dlgTextRefSpec>;

export const DLG_TEXT_REF_SIZE = 8;
