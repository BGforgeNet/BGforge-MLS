// Hand-written from IESDP dlg_v1.htm "DLG V1 State table". 16 bytes per record.

import { i32, u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const dlgStateSpec = {
    /** Strref of what the non-player character says. */
    text: { codec: i32 },
    firstTransition: { codec: u32 },
    transitionCount: { codec: u32 },
    /** Index into the state trigger table. Wire 0xFFFFFFFF reads as -1 via the signed codec, no sentinel branch. */
    triggerIndex: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export type DlgStateData = SpecData<typeof dlgStateSpec>;

export const DLG_STATE_SIZE = 16;
