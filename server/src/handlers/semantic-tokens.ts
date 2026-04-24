import { timeHandler } from "../shared/time-handler";
import { registry } from "../provider-registry";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.languages.semanticTokens.on(
        timeHandler(
            "semanticTokens",
            (params) => {
                const textDoc = ctx.documents.get(params.textDocument.uri);
                if (!textDoc) {
                    return { data: [] };
                }

                return registry.semanticTokens(textDoc.languageId, textDoc.getText(), params.textDocument.uri);
            },
            ctx.timingOpts,
        ),
    );
}
