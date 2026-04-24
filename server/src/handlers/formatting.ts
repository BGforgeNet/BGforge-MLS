import { MessageType } from "vscode-languageserver/node";
import { decodeFileUris } from "../user-messages";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onDocumentFormatting((params) => {
        const textDoc = ctx.documents.get(params.textDocument.uri);
        if (!textDoc) {
            return [];
        }
        const uri = params.textDocument.uri;
        const langId = textDoc.languageId;
        const text = textDoc.getText();

        const result = registry.format(langId, text, uri);
        if (result.warning) {
            // Use sendNotification (fire-and-forget) instead of showWarningMessage
            // (request/response) to avoid blocking the formatting response.
            // Cannot use showWarning() wrapper here for the same reason (it's request/response).
            // The ESLint no-restricted-syntax rule only targets .show*Message() member access.
            void ctx.connection.sendNotification("window/showMessage", {
                type: MessageType.Warning,
                message: decodeFileUris(result.warning),
            });
        }
        return result.edits;
    });
}
