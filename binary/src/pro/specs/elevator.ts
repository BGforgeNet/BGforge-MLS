import { u32 } from "typed-binary";
import { ElevatorType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const elevatorSpec = {
    elevatorType: { codec: u32, enum: ElevatorType },
    elevatorLevel: { codec: u32 },
} satisfies Record<string, FieldSpec>;

export type ElevatorData = SpecData<typeof elevatorSpec>;

export const elevatorPresentation: StructPresentation<ElevatorData> = {
    elevatorType: { label: "Elevator Type" },
    elevatorLevel: { label: "Elevator Level" },
};
