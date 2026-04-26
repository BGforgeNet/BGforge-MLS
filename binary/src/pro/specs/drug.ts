import { u32, i32 } from "typed-binary";
import type { FieldSpec, SpecData } from "../../spec/types";

export const drugSpec = {
    stat0: { codec: i32 },
    stat1: { codec: i32 },
    stat2: { codec: i32 },
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
