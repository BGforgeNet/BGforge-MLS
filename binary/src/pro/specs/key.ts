import { u32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const keySpec = {
    keyCode: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type KeyData = SpecData<typeof keySpec>;

export const keyPresentation: StructPresentation<KeyData> = {
    keyCode: { label: "Key Code", format: "hex32" },
};
