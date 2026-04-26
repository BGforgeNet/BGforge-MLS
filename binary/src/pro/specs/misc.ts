import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const miscSpec = {
    unknown: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type MiscData = SpecData<typeof miscSpec>;
