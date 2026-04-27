/**
 * Add/remove pathway for variable-length arrays in MAP files.
 *
 * Strategy: read the canonical document, mutate the array (and the linked
 * count field that mirrors its length), serialize via the existing
 * canonical writer, and let the caller reparse. Keeps add/remove on the
 * same byte-rebuild pipeline as every other MAP write — no buffer splicing.
 */

import type { ParseResult } from "../types";
import { getMapCanonicalDocument, rebuildMapCanonicalDocument } from "./canonical-reader";
import { serializeMapCanonicalDocument } from "./canonical-writer";
import type { MapCanonicalDocument } from "./canonical-schemas";

function readDocument(parseResult: ParseResult): MapCanonicalDocument | undefined {
    return getMapCanonicalDocument(parseResult) ?? rebuildMapCanonicalDocument(parseResult);
}

export function buildMapAddEntryBytes(parseResult: ParseResult, arrayPath: readonly string[]): Uint8Array | undefined {
    const doc = readDocument(parseResult);
    if (!doc) return undefined;

    if (arrayPath.length === 1 && arrayPath[0] === "Global Variables") {
        const next: MapCanonicalDocument = {
            ...doc,
            globalVariables: [...doc.globalVariables, 0],
            header: { ...doc.header, numGlobalVars: doc.header.numGlobalVars + 1 },
        };
        return serializeMapCanonicalDocument(next, parseResult.opaqueRanges);
    }

    return undefined;
}
