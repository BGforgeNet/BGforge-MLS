/**
 * Writer helpers for serialising ItmCanonicalDocument back to ITM v1 bytes.
 *
 * Built on the shared IE ability+effects writer factory
 * (`ie-common/ability-effects-writer.ts`), which recomputes the derived header
 * fields (`extendedHeadersOffset/Count`, `featureBlocksOffset`) from the doc
 * shape via `enforceDerivedFields` - a hand-edited canonical doc with stale or
 * wrong offsets cannot produce a corrupt file; the recompute fills in the
 * truth. `featureBlocksIndex` and `featureBlocksCount` encode the *equipping*
 * effect subset (per IESDP + parser comment in `itm/index.ts`), which the
 * writer has no derivation source for, so those values pass through as the user
 * supplied them.
 */

import { createIeAbilityEffectsWriter } from "../ie-common/ability-effects-writer";
import { itmAbilitySchema, itmHeaderSchema } from "./schemas";
import { ITM_ABILITY_SIZE, ITM_HEADER_SIZE } from "./types";
import { type ItmCanonicalDocument, type ItmCanonicalSnapshot } from "./canonical-schemas";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";

export const serializeItmCanonicalDocument = createIeAbilityEffectsWriter<
    ItmCanonicalDocument["header"],
    ItmCanonicalDocument["abilities"][number]
>({
    headerSize: ITM_HEADER_SIZE,
    abilitySize: ITM_ABILITY_SIZE,
    headerSchema: itmHeaderSchema,
    abilitySchema: itmAbilitySchema,
    headerSpec: itmHeaderSpecAnnotated,
});

export function serializeItmCanonicalSnapshot(snapshot: ItmCanonicalSnapshot): Uint8Array {
    return serializeItmCanonicalDocument(snapshot.document);
}
