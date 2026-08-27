/**
 * typed-binary schemas for DLG V1. Little-endian, one per wire struct. The tables are read record by
 * record in the parser rather than as spec-level arrays, matching how MAP handles its sections: the
 * counts live in another struct and the records are addressed by stored offset.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { dlgHeaderInterruptSpec, dlgHeaderSpec } from "./specs/header";
import { dlgStateSpec } from "./specs/state";
import { dlgTextRefSpec } from "./specs/text-ref";
import { dlgTransitionSpec } from "./specs/transition";

export const dlgHeaderSchema = toTypedBinarySchema(dlgHeaderSpec);
export const dlgHeaderInterruptSchema = toTypedBinarySchema(dlgHeaderInterruptSpec);
export const dlgStateSchema = toTypedBinarySchema(dlgStateSpec);
export const dlgTransitionSchema = toTypedBinarySchema(dlgTransitionSpec);
export const dlgTextRefSchema = toTypedBinarySchema(dlgTextRefSpec);
