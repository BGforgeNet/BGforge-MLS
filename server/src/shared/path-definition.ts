/**
 * Shared helpers for go-to-definition on file-path strings (COPY/COMPILE/INCLUDE in WeiDU TP2,
 * `#include` in Fallout SSL).
 *
 * The definition handler (handlers/definition.ts) falls back to a bare-word symbol lookup when the
 * language provider returns null, which would wrongly jump a path filename to a same-named symbol. A
 * provider avoids that by being AUTHORITATIVE for path strings: it returns a real file location when
 * the path resolves, and otherwise {@link selfLocation} (a no-op) so the fallback cannot fire.
 *
 * Only the language-agnostic leaves live here; each provider keeps its own path-extraction and
 * resolution rules (WeiDU %MOD_FOLDER%/heredoc/filename-first; SSL literal include paths).
 */

import type { Location } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import * as fs from "fs";
import * as path from "path";
import { pathToUri } from "../uri-utils";

const ZERO_RANGE = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/**
 * No-op sentinel pointing at the start of the path-string node itself. Returning this claims the path
 * authoritatively (so the handler's symbol fallback cannot wrong-jump off the filename) while leaving
 * navigation where it is, since there is no real target to open.
 */
export function selfLocation(node: SyntaxNode, uri: string): Location {
    const start = { line: node.startPosition.row, character: node.startPosition.column };
    return { uri, range: { start, end: start } };
}

/** A definition location at the top of the file at `absPath`. */
export function fileLocation(absPath: string): Location {
    return { uri: pathToUri(absPath), range: ZERO_RANGE };
}

/**
 * Absolute path if it exists, matched case-insensitively per segment: Fallout and Infinity Engine
 * filesystems are case-insensitive, so a case-sensitive checkout can differ from the casing a source
 * file writes. Returns null when no case-insensitive match exists.
 */
export function resolveExisting(absPath: string): string | null {
    if (fs.existsSync(absPath)) {
        return absPath;
    }
    const parts = absPath.split(path.sep);
    const first = parts[0] ?? "";
    let current = first === "" ? path.sep : first;
    for (const want of parts.slice(1)) {
        if (want === "") {
            continue;
        }
        let entries: string[];
        try {
            entries = fs.readdirSync(current);
        } catch {
            return null;
        }
        const match = entries.find((e) => e.toLowerCase() === want.toLowerCase());
        if (match === undefined) {
            return null;
        }
        current = path.join(current, match);
    }
    return fs.existsSync(current) ? current : null;
}
