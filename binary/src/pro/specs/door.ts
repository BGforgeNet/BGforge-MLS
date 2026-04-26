import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const doorSpec = {
    walkThruFlag: { codec: u32, domain: { min: 0, max: 1 } },
    unknown: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type DoorData = SpecData<typeof doorSpec>;
