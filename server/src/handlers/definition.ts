import { timeHandler } from "../shared/time-handler";
import { symbolAtPosition } from "../common";
import { registry } from "../provider-registry";
import { getServerContext } from "../server-context";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onDefinition(
        timeHandler(
            "onDefinition",
            async (params) => {
                const textDoc = ctx.documents.get(params.textDocument.uri);
                if (!textDoc) {
                    return;
                }
                const uri = params.textDocument.uri;
                const langId = textDoc.languageId;
                const text = textDoc.getText();

                // Suppress features in comment/param-name zones
                if (!registry.shouldProvideFeatures(langId, text, params.position)) {
                    return;
                }

                // Try provider first (AST-based definition, e.g. state labels in D files)
                const providerResult = await registry.definition(langId, text, params.position, uri);
                if (providerResult) {
                    return providerResult;
                }

                const symbol = symbolAtPosition(text, params.position);
                const serverCtx = await getServerContext();

                // Try translation definition (mstr/tra/@123 references -> .msg/.tra files)
                if (symbol) {
                    const traResult = serverCtx.translation.getDefinition(uri, langId, symbol, text);
                    if (traResult) {
                        return traResult;
                    }
                }

                // Try provider symbol definition (data-driven, from headers)
                if (symbol) {
                    return registry.symbolDefinition(langId, symbol);
                }

                return null;
            },
            ctx.timingOpts,
        ),
    );
}
