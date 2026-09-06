/**
 * Quick fixes for the syntax diagnostics the tree-sitter pass publishes.
 *
 * Only a MISSING-node diagnostic determines an edit: its wording (see `shared/tree-sitter-diagnostics.ts`)
 * names the exact token the grammar expected, and the node is zero-width, so both the text and the
 * insertion point are given. An ERROR-node diagnostic carries no expected token, and a compiler
 * diagnostic names a symbol rather than a token; neither gets an action.
 */

import {
    CodeActionKind,
    OptionalVersionedTextDocumentIdentifier,
    TextDocumentEdit,
    TextEdit,
    type CodeAction,
    type CodeActionParams,
    type Diagnostic,
} from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import { timeHandler } from "../shared/time-handler";
import type { HandlerContext } from "./context";

/** The MISSING-node wording, as `collectParseDiagnostics` formats it. */
const MISSING_TOKEN = /^missing '(.+)'$/;

/**
 * A missing token is fixable only when it is punctuation. Tree-sitter names an anonymous token by its
 * literal text but a named one by its grammar rule (`identifier`, `string`), and inserting that rule
 * name would be a guess at content only the author has.
 */
const PUNCTUATION = /^[^\p{L}\p{N}_\s]+$/u;

/** The token a diagnostic says is missing, or undefined when it names no insertable one. */
function missingToken(diagnostic: Diagnostic): string | undefined {
    // A 3.18 diagnostic message may be markup; only the plain wording this server publishes matches.
    const message = typeof diagnostic.message === "string" ? diagnostic.message : diagnostic.message.value;
    const token = MISSING_TOKEN.exec(message)?.[1];
    return token !== undefined && PUNCTUATION.test(token) ? token : undefined;
}

function insertTokenAction(diagnostic: Diagnostic, token: string, document: TextDocument): CodeAction {
    return {
        title: `Insert missing '${token}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diagnostic],
        isPreferred: true,
        edit: {
            // documentChanges rather than `changes`: the version pins the edit to the text the
            // diagnostic was computed from, so a stale fix is rejected instead of applied at a
            // position that has moved.
            documentChanges: [
                TextDocumentEdit.create(
                    OptionalVersionedTextDocumentIdentifier.create(document.uri, document.version),
                    // The diagnostic's range is widened by one column so the marker is visible; the
                    // token belongs at its start, where the zero-width MISSING node sits.
                    [TextEdit.insert(diagnostic.range.start, token)],
                ),
            ],
        },
    };
}

export function register(ctx: HandlerContext): void {
    ctx.connection.onCodeAction(
        timeHandler(
            "onCodeAction",
            (params: CodeActionParams) => {
                const document = ctx.documents.get(params.textDocument.uri);
                if (!document) {
                    return [];
                }
                const actions: CodeAction[] = [];
                for (const diagnostic of params.context.diagnostics) {
                    const token = missingToken(diagnostic);
                    if (token !== undefined) {
                        actions.push(insertTokenAction(diagnostic, token, document));
                    }
                }
                return actions;
            },
            ctx.timingOpts,
        ),
    );
}
