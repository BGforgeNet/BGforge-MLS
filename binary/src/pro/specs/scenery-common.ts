import { u8, u16, u32 } from "typed-binary";
import { ScenerySubType, MaterialType, WallLightFlags, ActionFlags } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

export const sceneryCommonSpec = {
    wallLightFlags: { codec: u16, flags: WallLightFlags },
    actionFlags: { codec: u16, flags: ActionFlags },
    scriptId: { codec: u32 },
    subType: { codec: u32, enum: ScenerySubType },
    materialId: { codec: u32, enum: MaterialType },
    soundId: { codec: u8 },
} satisfies Record<string, FieldSpec>;

export type SceneryCommonData = SpecData<typeof sceneryCommonSpec>;
