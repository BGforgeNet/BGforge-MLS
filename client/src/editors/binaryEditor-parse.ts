/**
 * Editor-side parse helper with graceful-map auto-fallback.
 *
 * The editor is best-effort display: a user opening a `.map` file expects
 * a tree they can inspect, not an error stub. The CLI is batch
 * verification: the same error must surface so a CI gate can fail. Same
 * library, different purposes — so the editor (only) retries permissively
 * when a strict parse returns errors that would prevent display.
 *
 * `parseForEditor` returns the actual options used. The caller stores
 * those on the document so subsequent reparses (incremental field edits,
 * revert) reuse the same shape — otherwise editing a graceful-loaded map
 * would silently re-fail on the next byte rebuild.
 */

import * as path from "path";
import type { BinaryParser, ParseOptions, ParseResult } from "@bgforge/binary";
import { buildEditorParseOptions } from "./binaryEditor-parseOptions";

export interface EditorParseOutcome {
    readonly parseResult: ParseResult;
    readonly parseOptions: ParseOptions | undefined;
}

export function parseForEditor(parser: BinaryParser, bytes: Uint8Array, filePath: string): EditorParseOutcome {
    const baseOptions = buildEditorParseOptions(filePath);
    const result = parser.parse(bytes, baseOptions);
    if (path.extname(filePath).toLowerCase() === ".map" && result.errors && result.errors.length > 0) {
        const gracefulOptions: ParseOptions = { ...baseOptions, gracefulMapBoundaries: true };
        const fallback = parser.parse(bytes, gracefulOptions);
        if (!fallback.errors || fallback.errors.length === 0) {
            return { parseResult: fallback, parseOptions: gracefulOptions };
        }
    }
    return { parseResult: result, parseOptions: baseOptions };
}
