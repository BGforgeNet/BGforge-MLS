import { u16, u32 } from "typed-binary";
import { WallLightFlags, ActionFlags, MaterialType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

export const wallSpec = {
    wallLightFlags: { codec: u16, flags: WallLightFlags },
    actionFlags: { codec: u16, flags: ActionFlags },
    scriptId: { codec: u32 },
    materialId: { codec: u32, enum: MaterialType },
} satisfies Record<string, FieldSpec>;

export type WallData = SpecData<typeof wallSpec>;
