/**
 * Reader helpers for rebuilding EffCanonicalSnapshot/EffCanonicalDocument
 * from a parsed display tree (ParseResult). The parser stores the canonical
 * doc on `result.document` directly; the rebuild path mirrors the other IE
 * formats and is exercised by the JSON-snapshot reload flow.
 */

import { parseWithSchemaValidation } from "../schema-validation";
import {
    type EffCanonicalDocument,
    type EffCanonicalSnapshot,
    effCanonicalDocumentSchemaPermissive,
    effCanonicalSnapshotSchemaPermissive,
} from "./canonical-schemas";
import type { ParseResult } from "../types";

export function getEffCanonicalDocument(result: ParseResult): EffCanonicalDocument | undefined {
    if (!result.document) return undefined;
    return parseWithSchemaValidation(
        effCanonicalDocumentSchemaPermissive,
        result.document,
        "Invalid EFF canonical document",
    );
}

export function rebuildEffCanonicalDocument(result: ParseResult): EffCanonicalDocument {
    const doc = getEffCanonicalDocument(result);
    if (!doc) {
        throw new Error(
            "EFF canonical document missing from ParseResult; display-tree-only rebuild is not implemented",
        );
    }
    return doc;
}

export function createEffCanonicalSnapshot(result: ParseResult): EffCanonicalSnapshot {
    const document = rebuildEffCanonicalDocument(result);
    const snapshot: EffCanonicalSnapshot = {
        schemaVersion: 1,
        format: "eff",
        formatName: result.formatName,
        document,
    };
    if (result.opaqueRanges && result.opaqueRanges.length > 0) {
        return parseWithSchemaValidation(
            effCanonicalSnapshotSchemaPermissive,
            { ...snapshot, opaqueRanges: result.opaqueRanges },
            "Invalid EFF canonical snapshot",
        );
    }
    if (result.warnings) {
        return { ...snapshot, warnings: result.warnings };
    }
    return snapshot;
}
