import { u8, u32 } from "typed-binary";
import { u24 } from "../../spec/codec-meta";
import { HeaderFlags, ObjectType, FRMType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

/**
 * Wire-shape spec for the PRO header (24 bytes, big-endian).
 *
 * `objectType` (1 byte) + `objectId` (3 bytes) read consecutively from the
 * first u32 on the wire; same for `frmType` + `frmId`. typed-binary's
 * sequential big-endian byte reads produce the split shape directly, so no
 * separate packed-field primitive is needed for these byte-aligned splits.
 */
export const headerSpec = {
    objectType: { codec: u8, enum: ObjectType },
    objectId: { codec: u24 },
    textId: { codec: u32 },
    frmType: { codec: u8, enum: FRMType },
    frmId: { codec: u24 },
    lightRadius: { codec: u32, domain: { min: 0, max: 8 } },
    lightIntensity: { codec: u32, domain: { min: 0, max: 65_536 } },
    flags: { codec: u32, flags: HeaderFlags },
} satisfies Record<string, FieldSpec>;

export type HeaderData = SpecData<typeof headerSpec>;

export const headerPresentation: StructPresentation<HeaderData> = {
    objectType: { label: "Object Type" },
    objectId: { label: "Object ID" },
    textId: { label: "Text ID" },
    frmType: { label: "FRM Type" },
    frmId: { label: "FRM ID" },
    lightRadius: { label: "Light Radius", unit: "0-8 hexes" },
    lightIntensity: { label: "Light Intensity", unit: "0-65536" },
    flags: { label: "Flags" },
};
