import { u16, u32, i8 } from "typed-binary";
import { i24 } from "../../spec/codec-meta";
import { WallLightFlags, ActionFlags, MaterialType, ScriptType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const wallSpec = {
    wallLightFlags: { codec: u16, flags: WallLightFlags },
    actionFlags: { codec: u16, flags: ActionFlags },
    scriptType: { codec: i8, enum: ScriptType },
    scriptId: { codec: i24 },
    materialId: { codec: u32, enum: MaterialType },
} satisfies Record<string, FieldSpec>;

export type WallData = SpecData<typeof wallSpec>;

export const wallPresentation: StructPresentation<WallData> = {
    wallLightFlags: { label: "Wall Light Flags" },
    actionFlags: { label: "Action Flags" },
    scriptType: { label: "Script Type" },
    scriptId: { label: "Script ID" },
    materialId: { label: "Material" },
};
