/**
 * Writer helpers for serialising SplCanonicalDocument back to SPL v1 bytes.
 *
 * Built on the shared IE ability+effects writer factory
 * (`ie-common/ability-effects-writer.ts`). Recomputes derived header fields
 * (`extendedHeadersOffset/Count`, `featureBlocksOffset`) from the doc shape;
 * feature-block subset metadata is preserved as the user supplied it (no
 * derivation source). See `itm/canonical-writer.ts` for the parallel shape and
 * rationale.
 */

import { createIeAbilityEffectsWriter } from "../ie-common/ability-effects-writer";
import { splAbilitySchema, splHeaderSchema } from "./schemas";
import { SPL_ABILITY_SIZE, SPL_HEADER_SIZE } from "./types";
import { type SplCanonicalDocument, type SplCanonicalSnapshot } from "./canonical-schemas";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";

export const serializeSplCanonicalDocument = createIeAbilityEffectsWriter<
    SplCanonicalDocument["header"],
    SplCanonicalDocument["abilities"][number]
>({
    headerSize: SPL_HEADER_SIZE,
    abilitySize: SPL_ABILITY_SIZE,
    headerSchema: splHeaderSchema,
    abilitySchema: splAbilitySchema,
    headerSpec: splHeaderSpecAnnotated,
    formatId: "spl",
});

export function serializeSplCanonicalSnapshot(snapshot: SplCanonicalSnapshot): Uint8Array {
    return serializeSplCanonicalDocument(snapshot.document);
}
