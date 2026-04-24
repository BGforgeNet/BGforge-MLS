import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onFoldingRanges((params) => {
        const textDoc = ctx.documents.get(params.textDocument.uri);
        if (!textDoc) {
            return [];
        }
        return registry.foldingRanges(textDoc.languageId, textDoc.getText());
    });
}
