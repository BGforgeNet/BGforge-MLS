/**
 * Infinity Engine SPL v1 parser. Mirrors ITM v1; abilities/effects share
 * the on-wire layout with ITM via `binary/src/ie-common/specs`, and the parse
 * discipline itself is shared via `createIeAbilityEffectsParser`.
 */

import { createIeAbilityEffectsParser } from "../ie-common/ability-effects-parser";
import { splAbilitySchema, splHeaderSchema } from "./schemas";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import { splAbilitySpecAnnotated } from "./specs/ability.overrides";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE, SPL_SIGNATURE, SPL_VERSION_V1 } from "./types";
import { serializeSpl } from "./serializer";

const splHeaderPresentation = {} as const;
const abilityPresentation = {} as const;

export const splParser = createIeAbilityEffectsParser({
    formatId: "spl",
    formatName: "Infinity Engine SPL v1",
    label: "SPL",
    extension: "spl",
    headerSize: SPL_HEADER_SIZE,
    abilitySize: SPL_ABILITY_SIZE,
    signature: [...SPL_SIGNATURE],
    versionV1: [...SPL_VERSION_V1],
    header: { schema: splHeaderSchema, spec: splHeaderSpecAnnotated, presentation: splHeaderPresentation },
    ability: { schema: splAbilitySchema, spec: splAbilitySpecAnnotated, presentation: abilityPresentation },
    serialize: serializeSpl,
});
