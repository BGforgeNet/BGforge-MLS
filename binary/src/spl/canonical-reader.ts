/**
 * SPL canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import { parseWithSchemaValidation } from "../schema-validation";
import { rebuildAbilityEffectsDocument } from "../ie-common/rebuild-ability-effects";
import { splHeaderSpecAnnotated } from "./specs/header.overrides";
import { splAbilityPresentation, splAbilitySpecAnnotated } from "./specs/ability.overrides";
import {
    type SplCanonicalDocument,
    type SplCanonicalSnapshot,
    splCanonicalDocumentSchemaPermissive,
    splCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParseResult } from "../types";

const splRebuildConfig = {
    label: "SPL",
    headerSpec: splHeaderSpecAnnotated,
    abilitySpec: splAbilitySpecAnnotated,
    headerPresentation: {},
    abilityPresentation: splAbilityPresentation,
} as const;

function rebuildFromDisplay(result: ParseResult): SplCanonicalDocument {
    const raw = rebuildAbilityEffectsDocument(result, splRebuildConfig);
    return parseWithSchemaValidation(splCanonicalDocumentSchemaPermissive, raw, "Invalid SPL canonical document");
}

const reader = createIeCanonicalReader<SplCanonicalDocument, SplCanonicalSnapshot>({
    formatId: "spl",
    formatLabel: "SPL",
    documentSchemaPermissive: splCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: splCanonicalSnapshotSchemaPermissive,
    rebuildFromDisplay,
});

export const getSplCanonicalDocument = reader.getDocument;
export const rebuildSplCanonicalDocument = reader.rebuildDocument;
export const createSplCanonicalSnapshot = reader.createSnapshot;
