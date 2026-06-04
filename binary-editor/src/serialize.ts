import { parserRegistry } from "@bgforge/binary";
import type { EditorSession } from "./session";

/** Serializes the session through the parser's canonical writer. There is no
 *  separate permissive write path - the editor uses the single strict canonical
 *  writer for all formats. Centralizing here keeps any future format-dispatch
 *  logic in one place. */
export function serializeSession(session: EditorSession): Uint8Array {
    const parser = parserRegistry.getById(session.parserId);
    if (!parser?.serialize) {
        throw new Error(`Parser "${session.parserId}" has no serialize`);
    }
    return parser.serialize(session.model.parseResult);
}
