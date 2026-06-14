import { i32 } from "typed-binary";
import { StatType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

// Every field of the fallout2-ce Drug struct is a signed `long`: stat deltas can be negative and the -1
// sentinel (no instant effect / no addiction perk) must read as -1, not 4294967295. Use i32 throughout
// (the durations / addiction rate / onset are non-negative in practice but stay i32 to match the engine).
export const drugSpec = {
    stat0: { codec: i32, enum: StatType },
    stat1: { codec: i32, enum: StatType },
    stat2: { codec: i32, enum: StatType },
    amount0Instant: { codec: i32 },
    amount1Instant: { codec: i32 },
    amount2Instant: { codec: i32 },
    duration1: { codec: i32 },
    amount0Delayed1: { codec: i32 },
    amount1Delayed1: { codec: i32 },
    amount2Delayed1: { codec: i32 },
    duration2: { codec: i32 },
    amount0Delayed2: { codec: i32 },
    amount1Delayed2: { codec: i32 },
    amount2Delayed2: { codec: i32 },
    addictionRate: { codec: i32 },
    addictionEffect: { codec: i32 },
    addictionOnset: { codec: i32 },
} satisfies Record<string, FieldSpec>;

export type DrugData = SpecData<typeof drugSpec>;

export const drugPresentation: StructPresentation<DrugData> = {
    stat0: { label: "Stat 0" },
    stat1: { label: "Stat 1" },
    stat2: { label: "Stat 2" },
    amount0Instant: { label: "Amount 0" },
    amount1Instant: { label: "Amount 1" },
    amount2Instant: { label: "Amount 2" },
    duration1: { label: "Duration" },
    amount0Delayed1: { label: "Amount 0" },
    amount1Delayed1: { label: "Amount 1" },
    amount2Delayed1: { label: "Amount 2" },
    duration2: { label: "Duration" },
    amount0Delayed2: { label: "Amount 0" },
    amount1Delayed2: { label: "Amount 1" },
    amount2Delayed2: { label: "Amount 2" },
    addictionRate: { label: "Rate", unit: "%" },
    addictionEffect: { label: "Effect" },
    addictionOnset: { label: "Onset" },
};
