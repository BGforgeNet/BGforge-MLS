import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const doorSpec = {
    walkThruFlag: { codec: u32, domain: { min: 0, max: 1 }, enum: { 0: "No", 1: "Yes" } },
    unknown: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type DoorData = SpecData<typeof doorSpec>;

export const doorPresentation: StructPresentation<DoorData> = {
    walkThruFlag: { label: "Walk Through" },
    unknown: { label: "Unknown" },
};
