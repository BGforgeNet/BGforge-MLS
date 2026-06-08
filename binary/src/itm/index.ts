/**
 * Infinity Engine ITM v1 parser.
 *
 * Decodes the 0x72-byte header, the variable-length abilities array
 * (extended headers, 0x38 each) at `header.extendedHeadersOffset`, and the
 * flat effects array (feature blocks, 0x30 each) at
 * `header.featureBlocksOffset`. Effects share the on-wire layout with SPL
 * via `binary/src/ie-common/specs/effect`; abilities differ between the
 * two formats and live in each format's own `specs/ability.ts`. The parse
 * discipline itself is shared with SPL via `createIeAbilityEffectsParser`.
 */

import { createIeAbilityEffectsParser } from "../ie-common/ability-effects-parser";
import { itmAbilitySchema, itmHeaderSchema } from "./schemas";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";
import { itmAbilityPresentation, itmAbilitySpecAnnotated } from "./specs/ability.overrides";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE, ITM_SIGNATURE, ITM_VERSION_V1 } from "./types";
import { serializeItm } from "./serializer";

/**
 * Header labels come from `humanize(fieldName)`; ability labels add the shared
 * `itmAbilityPresentation` overrides (THAC0 casing, Identification group legend).
 * Both flow through to the display tree without affecting wire round-trip.
 */
const itmHeaderPresentation = {} as const;
const abilityPresentation = itmAbilityPresentation;

export const itmParser = createIeAbilityEffectsParser({
    formatId: "itm",
    formatName: "Infinity Engine ITM v1",
    label: "ITM",
    extension: "itm",
    headerSize: ITM_HEADER_SIZE,
    abilitySize: ITM_ABILITY_SIZE,
    signature: [...ITM_SIGNATURE],
    versionV1: [...ITM_VERSION_V1],
    header: { schema: itmHeaderSchema, spec: itmHeaderSpecAnnotated, presentation: itmHeaderPresentation },
    ability: { schema: itmAbilitySchema, spec: itmAbilitySpecAnnotated, presentation: abilityPresentation },
    serialize: serializeItm,
    variantId: "item",
});
