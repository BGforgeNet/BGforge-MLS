import { u8, u16, u32, i8, i32 } from "typed-binary";
import { i24 } from "../../spec/codec-meta";
import { ScenerySubType, MaterialType, WallLightFlags, ActionFlags, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

// `materialId` uses a signed codec so the wire's `0xff_ff_ff_ff` "no proto
// default" pattern (proto.cc:956 — proto_scenery_init) reads naturally as -1.
// MaterialType maps -1 to "None"; the per-object material is what scripts and
// the engine use, so the proto field is informational for scenery.
export const sceneryCommonSpec = {
    wallLightFlags: { codec: u16, flags: WallLightFlags },
    actionFlags: { codec: u16, flags: ActionFlags },
    scriptType: { codec: i8, enum: ScriptType },
    scriptId: { codec: i24 },
    subType: { codec: u32, enum: ScenerySubType },
    materialId: { codec: i32, enum: MaterialType },
    soundId: { codec: u8 },
} satisfies Record<string, FieldSpec>;

export type SceneryCommonData = SpecData<typeof sceneryCommonSpec>;

export const sceneryCommonPresentation: StructPresentation<SceneryCommonData> = {
    wallLightFlags: { label: "Wall Light Flags" },
    actionFlags: { label: "Action Flags" },
    scriptType: { label: "Script Type" },
    scriptId: { label: "Script ID" },
    subType: { label: "Sub Type" },
    materialId: { label: "Material" },
    soundId: { label: "Sound ID" },
};
