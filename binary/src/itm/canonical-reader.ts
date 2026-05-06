/**
 * Reader helpers for rebuilding ItmCanonicalSnapshot/ItmCanonicalDocument
 * from a parsed display tree (ParseResult). The parser stores the canonical
 * doc on `result.document` directly; the rebuild path mirrors PRO/MAP and
 * is exercised by the JSON-snapshot reload flow.
 */

import { parseWithSchemaValidation } from "../schema-validation";
import {
    type ItmCanonicalDocument,
    type ItmCanonicalSnapshot,
    itmCanonicalDocumentSchemaPermissive,
    itmCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParseResult } from "../types";

export function getItmCanonicalDocument(result: ParseResult): ItmCanonicalDocument | undefined {
    if (!result.document) return undefined;
    return parseWithSchemaValidation(
        itmCanonicalDocumentSchemaPermissive,
        result.document,
        "Invalid ITM canonical document",
    );
}

export function rebuildItmCanonicalDocument(result: ParseResult): ItmCanonicalDocument {
    // The parser always sets result.document. A caller arriving here without
    // one would be programming error — display-tree-only rebuild via walkGroup
    // is not implemented (and not currently needed by any flow).
    const doc = getItmCanonicalDocument(result);
    if (!doc) {
        throw new Error(
            "ITM canonical document missing from ParseResult; display-tree-only rebuild is not implemented",
        );
    }
    return doc;
}

export function createItmCanonicalSnapshot(result: ParseResult): ItmCanonicalSnapshot {
    const document = rebuildItmCanonicalDocument(result);
    const snapshot: ItmCanonicalSnapshot = {
        schemaVersion: 1,
        format: "itm",
        formatName: result.formatName,
        document,
    };
    if (result.opaqueRanges && result.opaqueRanges.length > 0) {
        return parseWithSchemaValidation(
            itmCanonicalSnapshotSchemaPermissive,
            { ...snapshot, opaqueRanges: result.opaqueRanges },
            "Invalid ITM canonical snapshot",
        );
    }
    if (result.warnings) {
        return { ...snapshot, warnings: result.warnings };
    }
    return snapshot;
}
