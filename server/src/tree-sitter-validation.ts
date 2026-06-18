/**
 * Tree-sitter validation pass: parse a document and publish its parse errors as
 * diagnostics under the "tree-sitter" source.
 *
 * Scoped implicitly to the languages with a registered tree-sitter parser
 * (fallout-ssl, weidu-baf, weidu-d, weidu-tp2, fallout-msg, weidu-tra). The first
 * four also have a compiler; MSG/TRA are parser-only, so for them this is the sole
 * diagnostic source. Any language without a parser no-ops.
 *
 * Runs synchronously on every edit, deliberately NOT debounced like the external
 * compiler: the parse is in-memory, tree-sitter is fast, and instant feedback is
 * the point - a debounce would defeat it. `collectParseErrors` prunes clean
 * subtrees, so cost tracks the broken regions rather than file size.
 */

import { parserManager } from "../../shared/parsers/parser-manager";
import { setDiagnostics } from "./diagnostic-store";
import { collectParseErrors } from "./shared/tree-sitter-diagnostics";

/**
 * Parse `text` for `langId` and publish ERROR / MISSING nodes as the URI's
 * "tree-sitter" diagnostics. No-op for languages without a parser, or when the
 * parser is not yet initialized (the existing compiler diagnostics are left
 * untouched rather than cleared on a transient miss).
 */
export function updateTreeSitterDiagnostics(uri: string, langId: string, text: string): void {
    if (!parserManager.isInitialized(langId)) {
        return;
    }
    const tree = parserManager.parseWithCache(langId, text);
    if (!tree) {
        return;
    }
    setDiagnostics(uri, "tree-sitter", collectParseErrors(tree.rootNode));
}
