/**
 * Shared result type for unified file parsing.
 *
 * Returned by each language's parse function, containing both symbol definitions
 * and cross-file reference locations from a single AST walk.
 */

import type { Location } from "vscode-languageserver/node";
import type { IndexedSymbol, SourceType } from "./symbol";

/** Result of parsing a file for both symbols and references. */
export interface ParseResult {
    /** Symbol definitions extracted from the file. */
    readonly symbols: readonly IndexedSymbol[];
    /** Cross-file reference locations: symbolName/compositeKey -> Location[]. */
    readonly refs: ReadonlyMap<string, readonly Location[]>;
}

/** What every language's `parseFile` takes beside the file itself. */
export interface ParseFileOptions {
    /** Workspace root, for the relative path a symbol's hover shows. */
    readonly workspaceRoot?: string;
    /** Where the file's symbols come from (default: Workspace); Navigation for a file that is not a header. */
    readonly sourceType?: SourceType;
}

/** Empty parse result constant, avoids allocating new objects. */
export const EMPTY_PARSE_RESULT: ParseResult = {
    symbols: [],
    refs: new Map(),
};
