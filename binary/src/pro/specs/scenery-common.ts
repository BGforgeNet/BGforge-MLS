import { u8, u16, u32, i8 } from "typed-binary";
import { i24 } from "../../spec/codec-meta";
import { ScenerySubType, MaterialType, WallLightFlags, ActionFlags, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const sceneryCommonSpec = {
    wallLightFlags: { codec: u16, flags: WallLightFlags },
    actionFlags: { codec: u16, flags: ActionFlags },
    scriptType: { codec: i8, enum: ScriptType },
    scriptId: { codec: i24 },
    subType: { codec: u32, enum: ScenerySubType },
    materialId: { codec: u32, enum: MaterialType },
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
