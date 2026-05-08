/**
 * typed-binary schemas for SPL v1. Little-endian, like ITM. Abilities and
 * effects use the shared ie-common specs.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effectSpecAnnotated } from "../ie-common/specs/effect.overrides";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import { splAbilitySpecAnnotated } from "./specs/ability.overrides";
import type { SpecData } from "../spec/types";

// Wire codecs use the *annotated* specs so flag fields project through
// `intToFlagArray` / `flagArrayToInt` at the byte boundary - see
// itm/schemas.ts for the same pattern.
export const splHeaderSchema = toTypedBinarySchema(splHeaderSpecAnnotated);
export const splAbilitySchema = toTypedBinarySchema(splAbilitySpecAnnotated);
export const effectSchema = toTypedBinarySchema(effectSpecAnnotated);

export type SplHeaderData = SpecData<typeof splHeaderSpecAnnotated>;
export type SplAbilityData = SpecData<typeof splAbilitySpecAnnotated>;
export type EffectData = SpecData<typeof effectSpecAnnotated>;
