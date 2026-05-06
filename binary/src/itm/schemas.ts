/**
 * typed-binary schemas for ITM v1.
 *
 * ITM is little-endian (Intel x86 era — IESDP convention). typed-binary's
 * default endianness on a `BufferReader` constructed without an explicit
 * setting is little-endian, so callers create readers without an
 * `endianness` option (cf. PRO/MAP, which pass `{ endianness: "big" }`).
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effectSpec } from "../ie-common/specs";
import { itmHeaderSpec } from "./specs/header";
import { itmAbilitySpec } from "./specs/ability";

export const itmHeaderSchema = toTypedBinarySchema(itmHeaderSpec);
export const itmAbilitySchema = toTypedBinarySchema(itmAbilitySpec);
export const effectSchema = toTypedBinarySchema(effectSpec);

export type { ItmHeaderData } from "./specs/header";
export type { ItmAbilityData } from "./specs/ability";
export type { EffectData } from "../ie-common/specs";
