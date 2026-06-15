/**
 * EFF canonical-reader: thin wrapper around the IE canonical-reader factory
 * (`ie-common/canonical-reader.ts`).
 */

import { createIeCanonicalReader } from "../ie-common/canonical-reader";
import { parseWithSchemaValidation } from "../schema-validation";
import { structFromDisplayFull } from "../ie-common/rebuild-ability-effects";
import { effBodySpecAnnotated } from "./specs/body.overrides";
import { effHeaderSpec } from "./specs/header";
import {
    type EffCanonicalDocument,
    type EffCanonicalSnapshot,
    effCanonicalDocumentSchemaPermissive,
    effCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParsedGroup, ParseResult } from "../types";

function getGroup(root: ParsedGroup, name: string): ParsedGroup {
    const found = root.fields.find((e): e is ParsedGroup => "fields" in e && e.name === name);
    if (!found) throw new Error(`Missing EFF group: "${name}" in "${root.name}"`);
    return found;
}

/**
 * Rebuild an EFF canonical document from the display tree when
 * `result.document` is absent (i.e. the editor has modified the display tree
 * and not yet re-parsed from bytes).
 *
 * EFF v2 is a flat header + body record with no abilities or effects arrays.
 * The body contains `unused7` (15 x u32 padding) and `unused1`/`unused2`/
 * `unused3`/`unused4`/`unused5`/`unused6` plain scalars; the only array field
 * is `unused7`, which `walkStruct` renders as a single "(15 values)" padding
 * entry. `structFromDisplayFull` zero-fills it on the rebuild path.
 */
function rebuildEffFromDisplay(result: ParseResult): EffCanonicalDocument {
    const headerGroup = getGroup(result.root, "EFF Header");
    const bodyGroup = getGroup(result.root, "EFF Body");

    const header = structFromDisplayFull(headerGroup, effHeaderSpec, {});
    const body = structFromDisplayFull(bodyGroup, effBodySpecAnnotated, {});

    const raw = { header, body };
    return parseWithSchemaValidation(effCanonicalDocumentSchemaPermissive, raw, "Invalid EFF canonical document");
}

const reader = createIeCanonicalReader<EffCanonicalDocument, EffCanonicalSnapshot>({
    formatId: "eff",
    formatLabel: "EFF",
    documentSchemaPermissive: effCanonicalDocumentSchemaPermissive,
    snapshotSchemaPermissive: effCanonicalSnapshotSchemaPermissive,
    rebuildFromDisplay: rebuildEffFromDisplay,
});

export const getEffCanonicalDocument = reader.getDocument;
export const rebuildEffCanonicalDocument = reader.rebuildDocument;
export const createEffCanonicalSnapshot = reader.createSnapshot;
