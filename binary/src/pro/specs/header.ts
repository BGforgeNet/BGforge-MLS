import { u32 } from "typed-binary";
import { HeaderFlags, ObjectType, FRMType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

/**
 * Wire-shape spec for the PRO header (24 bytes, big-endian).
 *
 * Note that `objectTypeAndId` and `frmTypeAndId` are packed at the byte level:
 * the high byte is the type tag, the low three bytes are the id. The canonical
 * document shape splits them into `objectType` / `objectId` and
 * `frmType` / `frmId` (see canonical-schemas.ts). The display walker keeps the
 * unpacked view too. A future `packedSpec` primitive will let one declaration
 * drive all three layers; until then the unpacking lives in the canonical
 * reader/writer and `parseHeader`.
 */
export const headerSpec = {
    objectTypeAndId: { codec: u32, enum: ObjectType },
    textId: { codec: u32 },
    frmTypeAndId: { codec: u32, enum: FRMType },
    lightRadius: { codec: u32, domain: { min: 0, max: 8 } },
    lightIntensity: { codec: u32, domain: { min: 0, max: 65_536 } },
    flags: { codec: u32, flags: HeaderFlags },
} satisfies Record<string, FieldSpec>;

export type HeaderData = SpecData<typeof headerSpec>;
