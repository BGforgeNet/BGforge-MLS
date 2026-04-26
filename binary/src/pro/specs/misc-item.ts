import { u32, i32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const miscItemSpec = {
    powerPid: { codec: i32 },
    powerType: { codec: u32 },
    charges: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type MiscItemData = SpecData<typeof miscItemSpec>;
