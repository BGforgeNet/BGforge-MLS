import { u32 } from "typed-binary";
import { MaterialType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const tileSpec = {
    materialId: { codec: u32, enum: MaterialType },
} satisfies Record<string, FieldSpec>;

export type TileData = SpecData<typeof tileSpec>;

export const tilePresentation: StructPresentation<TileData> = {
    materialId: { label: "Material" },
};
