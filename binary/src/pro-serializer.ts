import { createProCanonicalSnapshot, serializeProCanonicalDocument } from "./pro-canonical";
import type { ParseResult } from "./types";

/**
 * Serialize a PRO ParseResult back to binary bytes from the canonical document only.
 * Transitional type/subtype edits are normalized in the editor/document layer before save.
 */
export function serializePro(result: ParseResult): Uint8Array {
    return serializeProCanonicalDocument(createProCanonicalSnapshot(result).document, result.formatName);
}
