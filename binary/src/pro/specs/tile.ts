import { u32 } from "typed-binary";
import { MaterialType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";

export const tileSpec = {
    materialId: { codec: u32, enum: MaterialType },
} satisfies Record<string, FieldSpec>;

export type TileData = SpecData<typeof tileSpec>;
