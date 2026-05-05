import { i32 } from "typed-binary";
import { ElevatorType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

// Signed codecs so the wire's `0xff_ff_ff_ff` "no proto default" pattern
// (proto.cc:976 — proto_scenery_subdata_init seeds both fields to -1) reads
// naturally as -1 with no separate sentinel layer. The map record's per-object
// value is what drives runtime behaviour for placed elevators (proto.cc:614);
// the proto field only matters for the rare script-spawned case.
export const elevatorSpec = {
    elevatorType: { codec: i32, enum: ElevatorType },
    elevatorLevel: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export type ElevatorData = SpecData<typeof elevatorSpec>;

export const elevatorPresentation: StructPresentation<ElevatorData> = {
    elevatorType: { label: "Elevator Type" },
    elevatorLevel: { label: "Elevator Level" },
};
