import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const genericScenerySpec = {
    unknown: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type GenericSceneryData = SpecData<typeof genericScenerySpec>;
