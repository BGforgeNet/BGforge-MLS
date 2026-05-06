/**
 * typed-binary schemas for SPL v1. Little-endian, like ITM. Abilities and
 * effects use the shared ie-common specs.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effectSpec } from "../ie-common/specs";
import { splHeaderSpec } from "./specs/header";
import { splAbilitySpec } from "./specs/ability";

export const splHeaderSchema = toTypedBinarySchema(splHeaderSpec);
export const splAbilitySchema = toTypedBinarySchema(splAbilitySpec);
export const effectSchema = toTypedBinarySchema(effectSpec);

export type { SplHeaderData } from "./specs/header";
export type { SplAbilityData } from "./specs/ability";
export type { EffectData } from "../ie-common/specs";
