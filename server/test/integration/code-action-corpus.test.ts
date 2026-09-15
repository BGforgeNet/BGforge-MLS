/**
 * Quick fixes against the real corpus.
 *
 * The handler's input is whatever the tree-sitter pass publishes for real mod sources, not a
 * hand-typed diagnostic, and the two shapes it must tell apart both occur there in bulk: a MISSING
 * node names the token the grammar expected, an ERROR node names nothing. This drives the registered
 * `onCodeAction` callback over every corpus file known to parse with errors and checks the offer on
 * each diagnostic the server would really send.
 *
 * The file set is the same committed allowlist `grammar-corpus-parse.test.ts` pins, so it is exactly
 * the corpus files that produce any parse diagnostic at all. Requires external repos
 * (`pnpm test:external`); skips cleanly without them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CodeAction, Connection, Diagnostic, TextDocuments } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Parser } from "web-tree-sitter";
import { FALLOUT_FIXTURES, IE_FIXTURES } from "./test-helpers";
import * as codeAction from "../../src/handlers/code-action";
import type { HandlerContext } from "../../src/handlers/context";
import { collectParseDiagnostics } from "../../src/shared/tree-sitter-diagnostics";
import * as falloutSsl from "../../../shared/parsers/fallout-ssl";
import * as weiduBaf from "../../../shared/parsers/weidu-baf";
import * as weiduD from "../../../shared/parsers/weidu-d";

interface ParserModule {
    initParser: () => Promise<void>;
    getParser: () => Parser;
}

interface AllowEntry {
    readonly files: readonly string[];
}
const ALLOWLIST: Record<string, AllowEntry> = JSON.parse(
    readFileSync(join(__dirname, "fixtures/known-parse-errors.json"), "utf8"),
);

const GRAMMARS: ReadonlyArray<{ name: string; mod: ParserModule; root: string; langId: string }> = [
    { name: "fallout-ssl", mod: falloutSsl, root: FALLOUT_FIXTURES, langId: "fallout-ssl" },
    { name: "weidu-baf", mod: weiduBaf, root: IE_FIXTURES, langId: "weidu-baf" },
    { name: "weidu-d", mod: weiduD, root: IE_FIXTURES, langId: "weidu-d" },
];

/** The message shape that determines a fix, and the token it names. Mirrors the handler's own rule. */
const FIXABLE = /^missing '([^\p{L}\p{N}_\s]+)'$/u;

type CodeActionHandler = (params: {
    textDocument: { uri: string };
    context: { diagnostics: Diagnostic[] };
}) => CodeAction[];

/** Register the handler over a mutable document map and hand back the wired callback plus that map. */
function wireHandler(): { handler: CodeActionHandler; docs: Map<string, TextDocument> } {
    const docs = new Map<string, TextDocument>();
    let wired: CodeActionHandler | undefined;
    // The mock shape the sibling handler tests use: only the members register() touches are provided.
    const connection = {
        onCodeAction: vi.fn((handler: CodeActionHandler) => {
            wired = handler;
        }),
    } as unknown as Connection;
    const documents = { get: (uri: string) => docs.get(uri) } as unknown as TextDocuments<TextDocument>;
    codeAction.register({ connection, documents, timingOpts: { warn: () => {} } } as unknown as HandlerContext);
    if (!wired) throw new Error("register() did not wire onCodeAction");
    return { handler: wired, docs };
}

/** What the handler offered for one diagnostic, in the same wording the expectation is built in. */
function describeOffer(actions: readonly CodeAction[]): string {
    if (actions.length === 0) return "no fix";
    if (actions.length > 1) return `${actions.length} actions`;
    const change = actions[0]?.edit?.documentChanges?.[0] as
        | { edits?: Array<{ range: { start: { line: number; character: number } }; newText: string }> }
        | undefined;
    const edits = change?.edits ?? [];
    if (edits.length !== 1) return `${edits.length} edits`;
    const edit = edits[0]!;
    return `insert '${edit.newText}' at ${edit.range.start.line}:${edit.range.start.character}`;
}

describe("code-action quick fixes over the real corpus", () => {
    const present = GRAMMARS.filter((g) => (ALLOWLIST[g.name]?.files ?? []).length > 0);

    it.skipIf(present.length === 0)(
        "offers one insert per missing punctuation token, and nothing for an unnamed error",
        async () => {
            const { handler, docs } = wireHandler();
            // What the handler offered, one line per diagnostic, so the whole corpus is judged in a
            // single assertion and a divergence prints as a diff naming the file and the diagnostic.
            const offers: string[] = [];
            const expected: string[] = [];
            let fixesOffered = 0;
            let unfixableSeen = 0;

            // Chained rather than Promise.all: parser init is sequential by the WASM TRANSFER_BUFFER
            // constraint (server/INTERNALS.md, Parser Initialization).
            await present.reduce<Promise<void>>((prev, g) => prev.then(() => g.mod.initParser()), Promise.resolve());

            for (const g of present) {
                const parser = g.mod.getParser();

                for (const rel of ALLOWLIST[g.name]?.files ?? []) {
                    const text = readFileSync(join(g.root, rel), "utf8");
                    // Parse and free per file: the corpus is large enough that retained trees add up.
                    const tree = parser.parse(text);
                    if (!tree) continue;
                    const diagnostics = collectParseDiagnostics(tree.rootNode);
                    tree.delete();

                    const uri = `file:///${rel}`;
                    docs.set(uri, TextDocument.create(uri, g.langId, 1, text));

                    for (const diagnostic of diagnostics) {
                        const actions = handler({ textDocument: { uri }, context: { diagnostics: [diagnostic] } });
                        const token = FIXABLE.exec(String(diagnostic.message))?.[1];
                        const at = `${diagnostic.range.start.line}:${diagnostic.range.start.character}`;
                        const where = `${rel} ${at} ${String(diagnostic.message)}`;
                        if (token === undefined) {
                            unfixableSeen++;
                        } else {
                            fixesOffered++;
                        }
                        expected.push(`${where} -> ${token === undefined ? "no fix" : `insert '${token}' at ${at}`}`);
                        offers.push(`${where} -> ${describeOffer(actions)}`);
                    }
                    docs.delete(uri);
                }
            }

            expect(offers).toEqual(expected);
            // Both classes must actually occur, or the assertion above compared two empty sets.
            expect({ fixable: fixesOffered > 0, unfixable: unfixableSeen > 0 }).toEqual({
                fixable: true,
                unfixable: true,
            });
        },
        180_000,
    );
});
