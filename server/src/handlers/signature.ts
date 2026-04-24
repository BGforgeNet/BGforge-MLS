import { getRequest as getSignatureRequest } from "../shared/signature";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onSignatureHelp((params) => {
        const uri = params.textDocument.uri;
        const document = ctx.documents.get(uri);
        if (!document) {
            return null;
        }
        const text = document.getText();
        const langId = document.languageId;

        // Parse signature request from text/position
        const request = getSignatureRequest(text, params.position);
        if (!request) {
            return null;
        }

        return registry.signature(langId, text, uri, request.symbol, request.parameter);
    });
}
