import { timeHandler } from "../shared/time-handler";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onDocumentSymbol(
        timeHandler(
            "onDocumentSymbol",
            (params) => {
                const textDoc = ctx.documents.get(params.textDocument.uri);
                if (!textDoc) {
                    return [];
                }
                return registry.symbols(textDoc.languageId, textDoc.getText());
            },
            ctx.timingOpts,
        ),
    );

    ctx.connection.onWorkspaceSymbol(
        timeHandler(
            "onWorkspaceSymbol",
            (params, token) => {
                return registry.workspaceSymbols(params.query, token);
            },
            ctx.timingOpts,
        ),
    );
}
