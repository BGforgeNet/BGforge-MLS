import type { InlayHint } from "vscode-languageserver/node";
import { registry } from "../provider-registry";
import { getServerContext } from "../server-context";
import { getDocumentSettings } from "../settings-service";
import { strRefInlayHints } from "../ie-resources/strref-features";
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
        const serverCtx = await getServerContext();

        const sites = registry.strRefs(langId, text, uri);
        let strRefs: InlayHint[] = [];
        if (sites.length > 0) {
            // Per-resource rather than the session-wide snapshot: a workspace can point different folders at
            // different installs, and the session copy is still at its defaults until the client answers the
            // global configuration request - which can land after the first request for a document.
            const { weidu } = await getDocumentSettings(uri);
            strRefs = strRefInlayHints(sites, (strref) => serverCtx.gameStrings.resolve(strref, weidu), params.range);
        }

        // The three sources annotate different references in the same file - a BAF line can hold both a `@100`
        // translation reference and a bare TLK strref - so they are merged, not raced. Returning the first
        // non-empty source would silently drop whichever kind lost.
        return [
            ...registry.inlayHints(langId, text, uri, params.range),
            ...strRefs,
            ...serverCtx.translation.getInlayHints(uri, langId, text, params.range),
        ];
    });
}
