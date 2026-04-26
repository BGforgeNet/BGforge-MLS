import { u32, i32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const miscItemSpec = {
    powerPid: { codec: i32 },
    powerType: { codec: u32 },
    charges: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type MiscItemData = SpecData<typeof miscItemSpec>;

export const miscItemPresentation: StructPresentation<MiscItemData> = {
    powerPid: { label: "Power PID" },
    powerType: { label: "Power Type" },
    charges: { label: "Charges" },
};
