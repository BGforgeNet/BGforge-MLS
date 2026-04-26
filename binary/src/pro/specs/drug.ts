import { u32, i32 } from "typed-binary";
import { StatType } from "../types";
import type { FieldSpec, SpecData } from "../../spec/types";
import type { StructPresentation } from "../../spec/presentation";

export const drugSpec = {
    stat0: { codec: i32, enum: StatType },
    stat1: { codec: i32, enum: StatType },
    stat2: { codec: i32, enum: StatType },
    amount0Instant: { codec: u32 },
    amount1Instant: { codec: u32 },
    amount2Instant: { codec: u32 },
    duration1: { codec: u32 },
    amount0Delayed1: { codec: u32 },
    amount1Delayed1: { codec: u32 },
    amount2Delayed1: { codec: u32 },
    duration2: { codec: u32 },
    amount0Delayed2: { codec: u32 },
    amount1Delayed2: { codec: u32 },
    amount2Delayed2: { codec: u32 },
    addictionRate: { codec: u32 },
    addictionEffect: { codec: u32 },
    addictionOnset: { codec: u32 },
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
