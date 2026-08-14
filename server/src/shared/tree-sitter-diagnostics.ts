/**
 * Extract diagnostics from a tree-sitter parse tree.
 *
 * Tree-sitter is error-tolerant: on malformed input it plants two kinds of
 * marker node and keeps going.
 *
 *  - MISSING: the grammar required a token that was absent. The node's `type`
 *    is the expected token, so we can say exactly what is missing. Zero-width.
 *  - ERROR: a span tree-sitter could not fit the grammar at all. It carries no
 *    "expected" information - only a location and the offending text - so the
 *    message is necessarily generic, anchored on the first token of the span.
 *
 * These complement (do not replace) the authoritative compiler diagnostics:
 * they appear instantly as the user types, before the external compiler runs.
 */

import { type Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node";
import type { Node as SyntaxNode } from "web-tree-sitter";
import { collectParseErrors } from "../../../shared/parse-errors";

/** Diagnostic source label - distinct from the compiler's "BGforge MLS" so hovers say which engine flagged it. */
const DIAG_SOURCE = "BGforge MLS (syntax)";

/** Cap the offending-token text so a long/multiline error span keeps the hover readable. */
const MAX_TOKEN_LEN = 32;

/**
 * A diagnostic for each ERROR / MISSING node. The walk itself is shared with the compiler, which needs
 * the same nodes with different wording; only the phrasing and the LSP range are this file's business.
 */
export function collectParseDiagnostics(rootNode: SyntaxNode): Diagnostic[] {
    return collectParseErrors(rootNode).map((node) =>
        makeDiagnostic(node, node.isMissing ? `missing '${node.type}'` : errorMessage(node)),
    );
}

/** "Syntax error near '<token>'", or bare "Syntax error" when no token text is recoverable. */
function errorMessage(node: SyntaxNode): string {
    const token = firstToken(node);
    return token ? `Syntax error near '${token}'` : "Syntax error";
}

function firstToken(node: SyntaxNode): string {
    // The first child is usually the first real token of the bad span; fall back
    // to the span's own text. Trim, take the first line and first whitespace-run.
    const raw = (node.children[0]?.text ?? node.text).trim();
    if (raw.length === 0) {
        return "";
    }
    const firstLine = raw.split("\n", 1)[0] ?? raw;
    const token = firstLine.split(/\s+/, 1)[0] ?? firstLine;
    return token.length > MAX_TOKEN_LEN ? `${token.slice(0, MAX_TOKEN_LEN)}...` : token;
}

function makeDiagnostic(node: SyntaxNode, message: string): Diagnostic {
    const start = { line: node.startPosition.row, character: node.startPosition.column };
    // MISSING nodes are zero-width; a zero-width range renders as a bare caret with
    // no squiggle, so widen the end by one column to make the marker visible.
    const end =
        node.startIndex === node.endIndex
            ? { line: node.startPosition.row, character: node.startPosition.column + 1 }
            : { line: node.endPosition.row, character: node.endPosition.column };
    return {
        severity: DiagnosticSeverity.Error,
        range: { start, end },
        message,
        source: DIAG_SOURCE,
    };
}
