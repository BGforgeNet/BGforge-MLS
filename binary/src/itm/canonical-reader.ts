/**
 * ITM canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`). The factory body documents the shared
 * shape; this file only supplies ITM's schemas and format discriminants.
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import { parseWithSchemaValidation } from "../schema-validation";
import { rebuildAbilityEffectsDocument } from "../ie-common/rebuild-ability-effects";
import { itmHeaderSpecAnnotated } from "./specs/header.overrides";
import { itmAbilitySpecAnnotated } from "./specs/ability.overrides";
import {
    type ItmCanonicalDocument,
    type ItmCanonicalSnapshot,
    itmCanonicalDocumentSchemaPermissive,
    itmCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParseResult } from "../types";

const itmRebuildConfig = {
    label: "ITM",
    headerSpec: itmHeaderSpecAnnotated,
    abilitySpec: itmAbilitySpecAnnotated,
    headerPresentation: {},
    abilityPresentation: {},
} as const;

function rebuildFromDisplay(result: ParseResult): ItmCanonicalDocument {
    const raw = rebuildAbilityEffectsDocument(result, itmRebuildConfig);
    return parseWithSchemaValidation(itmCanonicalDocumentSchemaPermissive, raw, "Invalid ITM canonical document");
}

const reader = createIeCanonicalReader<ItmCanonicalDocument, ItmCanonicalSnapshot>({
    formatId: "itm",
    formatLabel: "ITM",
    documentSchemaPermissive: itmCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: itmCanonicalSnapshotSchemaPermissive,
    rebuildFromDisplay,
});

export const getItmCanonicalDocument = reader.getDocument;
export const rebuildItmCanonicalDocument = reader.rebuildDocument;
export const createItmCanonicalSnapshot = reader.createSnapshot;
