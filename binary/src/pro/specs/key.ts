import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const keySpec = {
    keyCode: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type KeyData = SpecData<typeof keySpec>;
