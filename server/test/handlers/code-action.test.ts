/**
 * Unit tests for the code-action handler.
 *
 * The handler turns one diagnostic shape into one quick fix: a tree-sitter MISSING node, whose
 * message names the exact token the grammar expected. Everything else - the ERROR-node
 * "Syntax error near ..." wording, a compiler diagnostic, a missing token that is not punctuation -
 * must produce no action, since none of them determines a single correct edit.
 *
 * The end-to-end case parses real SSL through the real parser, so the diagnostic the fix is offered
 * for is the one the server actually publishes, and the fixed text is re-parsed to confirm the
 * missing token is gone.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import {
    CodeActionKind,
    TextDocumentEdit,
    type CodeAction,
    type Connection,
    type Diagnostic,
    type TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import * as codeAction from "../../src/handlers/code-action";
import type { HandlerContext } from "../../src/handlers/context";
import { DIAG_SOURCE, collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";
import { getParser, initParser } from "../../../shared/parsers/fallout-ssl";

type CodeActionHandler = (params: {
    textDocument: { uri: string };
    context: { diagnostics: Diagnostic[] };
}) => CodeAction[];

const URI = "file:///test.ssl";

/** Register the handler over a document map and hand back the callback it wired. */
function wire(docs: Map<string, TextDocument>): CodeActionHandler {
    let wired: CodeActionHandler | undefined;
    const connection = {
        onCodeAction: vi.fn((handler: CodeActionHandler) => {
            wired = handler;
        }),
    } as unknown as Connection;
    const documents = { get: (uri: string) => docs.get(uri) } as unknown as TextDocuments<TextDocument>;
    const ctx = { connection, documents, timingOpts: { warn: () => {} } } as unknown as HandlerContext;
    codeAction.register(ctx);
    if (!wired) throw new Error("register() did not wire onCodeAction");
    return wired;
}

function makeDocs(text: string): Map<string, TextDocument> {
    return new Map([[URI, TextDocument.create(URI, "fallout-ssl", 1, text)]]);
}

/** A tree-sitter syntax diagnostic in the wording `collectParseDiagnostics` produces. */
function syntaxDiagnostic(message: string, line: number, character: number): Diagnostic {
    return {
        message,
        range: { start: { line, character }, end: { line, character: character + 1 } },
        source: DIAG_SOURCE,
    };
}

/** The single insert an action carries: its position and text. */
function soleInsert(action: CodeAction): { line: number; character: number; newText: string } {
    const changes = action.edit?.documentChanges;
    expect(changes).toHaveLength(1);
    const change = changes?.[0];
    if (!change || !TextDocumentEdit.is(change)) throw new Error("expected a TextDocumentEdit");
    expect(change.textDocument.uri).toBe(URI);
    expect(change.edits).toHaveLength(1);
    const edit = change.edits[0] as { range: { start: { line: number; character: number } }; newText: string };
    return { ...edit.range.start, newText: edit.newText };
}

describe("code-action handler", () => {
    it("offers an insert of the exact token a MISSING diagnostic names", () => {
        const handler = wire(makeDocs("procedure start begin\n    display_msg(1;\nend\n"));
        const diagnostic = syntaxDiagnostic("missing ')'", 1, 18);

        const actions = handler({ textDocument: { uri: URI }, context: { diagnostics: [diagnostic] } });

        expect(actions).toHaveLength(1);
        expect(actions[0]?.title).toBe("Insert missing ')'");
        expect(actions[0]?.kind).toBe(CodeActionKind.QuickFix);
        expect(actions[0]?.diagnostics).toEqual([diagnostic]);
        expect(soleInsert(actions[0]!)).toEqual({ line: 1, character: 18, newText: ")" });
    });

    it("offers nothing for an ERROR-node diagnostic, which names no expected token", () => {
        const handler = wire(makeDocs("procedure start begin\nend\n"));
        const diagnostic = syntaxDiagnostic("Syntax error near 'begin'", 0, 16);

        expect(handler({ textDocument: { uri: URI }, context: { diagnostics: [diagnostic] } })).toEqual([]);
    });

    it("offers nothing when the missing token is a grammar rule name rather than punctuation", () => {
        const handler = wire(makeDocs("procedure  begin\nend\n"));
        // Inserting the literal text "identifier" would be a guess at a name only the author knows.
        const diagnostic = syntaxDiagnostic("missing 'identifier'", 0, 10);

        expect(handler({ textDocument: { uri: URI }, context: { diagnostics: [diagnostic] } })).toEqual([]);
    });

    it("offers nothing for a compiler diagnostic", () => {
        const handler = wire(makeDocs("procedure start begin\nend\n"));
        const diagnostic: Diagnostic = {
            message: "Unknown identifier qq.",
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 2 } },
            source: "BGforge MLS",
        };

        expect(handler({ textDocument: { uri: URI }, context: { diagnostics: [diagnostic] } })).toEqual([]);
    });

    it("offers nothing for another source's diagnostic that happens to use the same wording", () => {
        const handler = wire(makeDocs("procedure start begin\n    display_msg(1;\nend\n"));
        const diagnostic: Diagnostic = {
            message: "missing ')'",
            range: { start: { line: 1, character: 18 }, end: { line: 1, character: 19 } },
            source: "some other extension",
        };

        expect(handler({ textDocument: { uri: URI }, context: { diagnostics: [diagnostic] } })).toEqual([]);
    });

    it("offers nothing for a document the server does not hold", () => {
        const handler = wire(new Map());

        expect(
            handler({ textDocument: { uri: URI }, context: { diagnostics: [syntaxDiagnostic("missing ')'", 0, 0)] } }),
        ).toEqual([]);
    });

    describe("against the real parser", () => {
        beforeAll(async () => {
            await initParser();
        });

        it("fixes the missing token the parser reports, and the fixed text parses without it", () => {
            const source = "procedure start begin\n    display_msg(1;\nend\n";
            const tree = getParser().parse(source);
            const diagnostics = collectParseDiagnostics(tree!.rootNode);
            tree!.delete();

            const missing = diagnostics.filter((d) => String(d.message).startsWith("missing "));
            expect(missing).toHaveLength(1);
            expect(missing[0]?.message).toBe("missing ')'");

            const handler = wire(makeDocs(source));
            const actions = handler({ textDocument: { uri: URI }, context: { diagnostics: missing } });
            expect(actions).toHaveLength(1);

            const insert = soleInsert(actions[0]!);
            const doc = TextDocument.create(URI, "fallout-ssl", 1, source);
            const offset = doc.offsetAt({ line: insert.line, character: insert.character });
            const fixed = source.slice(0, offset) + insert.newText + source.slice(offset);

            const fixedTree = getParser().parse(fixed);
            const after = collectParseDiagnostics(fixedTree!.rootNode);
            fixedTree!.delete();
            expect(after.filter((d) => d.message === "missing ')'")).toEqual([]);
        });
    });
});
