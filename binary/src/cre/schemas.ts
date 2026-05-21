/**
 * typed-binary schemas for CRE v1. Effects use either the format's own EFF v1
 * spec or the shared `ie-common` EFF v2 body, dispatched at parse time on
 * the header's `effStructureVersion` byte.
 */

import { toTypedBinarySchema } from "../spec/derive-typed-binary";
import { effBodySpecAnnotated } from "../eff/specs/body.overrides";
import type { SpecData } from "../spec/types";
import { creEffectV1Spec } from "./specs/effect-v1";
import { creHeaderSpecAnnotated } from "./specs/header.overrides";
import { creItemSpecAnnotated } from "./specs/item.overrides";
import { creKnownSpellSpecAnnotated } from "./specs/known-spell.overrides";
import { creMemorizedSpellSpecAnnotated } from "./specs/memorized-spell.overrides";
import { creSpellMemInfoSpecAnnotated } from "./specs/spell-mem-info.overrides";

export const creHeaderSchema = toTypedBinarySchema(creHeaderSpecAnnotated);
export const creKnownSpellSchema = toTypedBinarySchema(creKnownSpellSpecAnnotated);
export const creSpellMemInfoSchema = toTypedBinarySchema(creSpellMemInfoSpecAnnotated);
export const creMemorizedSpellSchema = toTypedBinarySchema(creMemorizedSpellSpecAnnotated);
export const creItemSchema = toTypedBinarySchema(creItemSpecAnnotated);
export const creEffectV1Schema = toTypedBinarySchema(creEffectV1Spec);
// CRE v2 effects share the 264-byte EFF v2 body shape with `.eff` files.
// IESDP: "CRE effect V2 structures omit the 8-byte EFF V2 header", so each
// record on the wire is exactly the body block. The body spec already
// embeds the redundant `signature2` / `version2` at offsets 0-7, matching
// the engine's encoding.
export const creEffectV2Schema = toTypedBinarySchema(effBodySpecAnnotated);

export type CreHeaderData = SpecData<typeof creHeaderSpecAnnotated>;
export type CreKnownSpellData = SpecData<typeof creKnownSpellSpecAnnotated>;
export type CreSpellMemInfoData = SpecData<typeof creSpellMemInfoSpecAnnotated>;
export type CreMemorizedSpellData = SpecData<typeof creMemorizedSpellSpecAnnotated>;
export type CreItemData = SpecData<typeof creItemSpecAnnotated>;
export type CreEffectV1Data = SpecData<typeof creEffectV1Spec>;
export type CreEffectV2Data = SpecData<typeof effBodySpecAnnotated>;
