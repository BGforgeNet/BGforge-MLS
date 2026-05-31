import { parserRegistry } from "@bgforge/binary";
import type { EditorSession } from "./session";

/** Permissive serialize seam. For now this delegates to the parser's existing
 *  writer; a later task replaces it with a per-format wire-level writer that
 *  bypasses strict canonical validation. Centralizing it here keeps that
 *  future swap to one file. */
export function serializeSession(session: EditorSession): Uint8Array {
    const parser = parserRegistry.getById(session.parserId);
    if (!parser?.serialize) {
        throw new Error(`Parser "${session.parserId}" has no serialize`);
    }
    return parser.serialize(session.model.parseResult);
}
