import type { TextDocumentPositionParams } from "vscode-languageserver/node";
import { symbolAtPosition } from "../cursor-utils";
import { conlog } from "../logger";
import { timeHandler } from "../shared/time-handler";
import { registry } from "../provider-registry";
import { getServerContext } from "../server-context";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onHover(
        timeHandler(
            "onHover",
            async (textDocumentPosition: TextDocumentPositionParams) => {
                const uri = textDocumentPosition.textDocument.uri;
                const textDoc = ctx.documents.get(uri);
                if (!textDoc) {
                    return;
                }
                const langId = textDoc.languageId;
                const text = textDoc.getText();
                const symbol = symbolAtPosition(text, textDocumentPosition.position);
                const serverCtx = await getServerContext();
                const { debug } = serverCtx.settings;

                if (!symbol) {
                    if (debug) conlog(`[hover] no symbol at position in ${uri}`);
                    return;
                }

                if (debug) conlog(`[hover] symbol="${symbol}" langId="${langId}" uri="${uri}"`);

                // Suppress all features in comment zones
                if (!registry.shouldProvideFeatures(langId, text, textDocumentPosition.position)) {
                    if (debug) conlog(`[hover] suppressed (shouldProvideFeatures=false)`);
                    return;
                }

                // Check translation hover first (for @123 or NOption(123) references)
                const translationHover = serverCtx.translation.getHover(uri, langId, symbol, text);
                if (translationHover) {
                    if (debug) conlog(`[hover] translation hover returned`);
                    return translationHover;
                }

                // Try local hover (AST-based, for symbols defined in current file)
                const localHover = registry.localHover(langId, text, symbol, uri, textDocumentPosition.position);
                if (localHover.handled) {
                    if (debug) conlog(`[hover] localHover handled, result=${localHover.hover ? "found" : "null"}`);
                    return localHover.hover;
                }

                // Fall back to data-driven hover (name lookup from headers/static data). Like the
                // definition symbol fallback, never run it on string content: a filename inside a
                // path string can match an indexed symbol name and show a spurious hover for it.
                if (registry.isPositionInString(langId, text, textDocumentPosition.position)) {
                    if (debug) conlog(`[hover] suppressed (cursor in string)`);
                    return null;
                }
                // Pass text to enable unified symbol resolution (Approach C)
                const dataHover = registry.hover(langId, uri, symbol, text);
                if (debug) conlog(`[hover] dataHover result=${dataHover ? "found" : "null"}`);
                return dataHover;
            },
            ctx.timingOpts,
        ),
    );
}
