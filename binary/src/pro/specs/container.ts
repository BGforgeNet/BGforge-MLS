import { u32 } from "typed-binary";
import { ContainerFlags } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const containerSpec = {
    maxSize: { codec: u32 },
    openFlags: { codec: u32, flags: ContainerFlags },
} satisfies Record<string, FieldSpec>;

export type ContainerData = SpecData<typeof containerSpec>;

export const containerPresentation: StructPresentation<ContainerData> = {
    maxSize: { label: "Max Size" },
    openFlags: { label: "Open Flags" },
};
