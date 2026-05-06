/**
 * Reader helpers for rebuilding SplCanonicalSnapshot/SplCanonicalDocument
 * from a parsed display tree (ParseResult). The parser stores the canonical
 * doc on `result.document` directly; the rebuild path is for snapshot reload.
 */

import { parseWithSchemaValidation } from "../schema-validation";
import {
    type SplCanonicalDocument,
    type SplCanonicalSnapshot,
    splCanonicalDocumentSchemaPermissive,
    splCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParseResult } from "../types";

export function getSplCanonicalDocument(result: ParseResult): SplCanonicalDocument | undefined {
    if (!result.document) return undefined;
    return parseWithSchemaValidation(
        splCanonicalDocumentSchemaPermissive,
        result.document,
        "Invalid SPL canonical document",
    );
}

export function rebuildSplCanonicalDocument(result: ParseResult): SplCanonicalDocument {
    const doc = getSplCanonicalDocument(result);
    if (!doc) {
        throw new Error(
            "SPL canonical document missing from ParseResult; display-tree-only rebuild is not implemented",
        );
    }
    return doc;
}

export function createSplCanonicalSnapshot(result: ParseResult): SplCanonicalSnapshot {
    const document = rebuildSplCanonicalDocument(result);
    const snapshot: SplCanonicalSnapshot = {
        schemaVersion: 1,
        format: "spl",
        formatName: result.formatName,
        document,
    };
    if (result.opaqueRanges && result.opaqueRanges.length > 0) {
        return parseWithSchemaValidation(
            splCanonicalSnapshotSchemaPermissive,
            { ...snapshot, opaqueRanges: result.opaqueRanges },
            "Invalid SPL canonical snapshot",
        );
    }
    if (result.warnings) {
        return { ...snapshot, warnings: result.warnings };
    }
    return snapshot;
}
