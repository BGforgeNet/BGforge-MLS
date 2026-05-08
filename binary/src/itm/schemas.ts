/**
 * typed-binary schemas for ITM v1.
 *
 * ITM is little-endian (Intel x86 era — IESDP convention). typed-binary's
 * default endianness on a `BufferReader` constructed without an explicit
 * setting is little-endian, so callers create readers without an
 * `endianness` option (cf. PRO/MAP, which pass `{ endianness: "big" }`).
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";
import { itmAbilitySpecAnnotated } from "./specs/ability.overrides";

// Wire codecs use the *annotated* specs so flag fields project through
// `intToFlagArray` / `flagArrayToInt` at the byte boundary — the
// canonical-doc surface (which is built off the same annotated specs) sees
// flags as sorted-array `{flags, flagsRaw?}` projections, matching what the
// zod schema validates.
export const itmHeaderSchema = toTypedBinarySchema(itmHeaderSpecAnnotated);
export const itmAbilitySchema = toTypedBinarySchema(itmAbilitySpecAnnotated);
export const effectSchema = toTypedBinarySchema(effectSpecAnnotated);

// Re-export the data types projected from the *annotated* specs so flag
// fields surface as `{flags: string[], flagsRaw?: string}` (the sorted-array
// projection) rather than `number`. The bare-spec types in `./specs/header`
// etc. remain the underlying source for the spread, but consumers (parser,
// canonical reader/writer) should consume the annotated projection.
import type { SpecData } from "../spec/types";

export type ItmHeaderData = SpecData<typeof itmHeaderSpecAnnotated>;
export type ItmAbilityData = SpecData<typeof itmAbilitySpecAnnotated>;
export type EffectData = SpecData<typeof effectSpecAnnotated>;
