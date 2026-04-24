import { registry } from "../provider-registry";
import { getServerContext } from "../server-context";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.languages.inlayHint.on(async (params) => {
        const uri = params.textDocument.uri;
        const document = ctx.documents.get(uri);
        if (!document) {
            return;
        }
        const text = document.getText();
        const langId = document.languageId;

        // Try provider first (for AST-based inlay hints)
        const providerResult = registry.inlayHints(langId, text, uri, params.range);
        if (providerResult.length > 0) {
            return providerResult;
        }

        // Fall back to translation-based inlay hints
        const serverCtx = await getServerContext();
        return serverCtx.translation.getInlayHints(uri, langId, text, params.range);
    });
}
