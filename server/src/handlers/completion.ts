import { type CompletionParams, CompletionItem } from "vscode-languageserver/node";
import { timeHandler } from "../shared/time-handler";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onCompletion(
        timeHandler(
            "onCompletion",
            (params: CompletionParams) => {
                const uri = params.textDocument.uri;
                const textDoc = ctx.documents.get(uri);
                if (!textDoc) {
                    return [];
                }
                const langId = textDoc.languageId;
                const text = textDoc.getText();
                return registry.completion(langId, text, uri, params.position, params.context?.triggerCharacter);
            },
            ctx.timingOpts,
        ),
    );

    ctx.connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
        return item;
    });
}
