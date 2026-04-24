import { TextDocumentEdit } from "vscode-languageserver/node";
import { normalizeUri, type NormalizedUri } from "../core/normalized-uri";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onPrepareRename((params) => {
        const textDoc = ctx.documents.get(params.textDocument.uri);
        if (!textDoc) {
            return null;
        }
        const langId = textDoc.languageId;
        const text = textDoc.getText();
        return registry.prepareRename(langId, text, params.position);
    });

    ctx.connection.onRenameRequest(async (params) => {
        const textDoc = ctx.documents.get(params.textDocument.uri);
        if (!textDoc) {
            return null;
        }
        const uri = params.textDocument.uri;
        const langId = textDoc.languageId;
        const text = textDoc.getText();

        const result = await registry.rename(langId, text, params.position, params.newName, uri);

        if (result?.documentChanges && result.documentChanges.length > 0) {
            const uris: NormalizedUri[] = [];
            for (const dc of result.documentChanges) {
                if (TextDocumentEdit.is(dc)) {
                    uris.push(normalizeUri(dc.textDocument.uri));
                }
            }
            ctx.renameSuppression.markAffected(uris);
        }

        return result;
    });
}
