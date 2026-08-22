import { timeHandler } from "../shared/time-handler";
import { symbolAtPosition } from "../cursor-utils";
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

                const symbol = symbolAtPosition(text, params.position, registry.identifierExtraChars(langId));
                const serverCtx = await getServerContext();

                // Try translation definition (mstr/tra/@123 references -> .msg/.tra files)
                if (symbol) {
                    const traResult = serverCtx.translation.getDefinition(uri, langId, symbol, text);
                    if (traResult) {
                        return traResult;
                    }
                }

                // Try provider symbol definition (data-driven, from headers). This matches the bare
                // word under the cursor against indexed symbol names, so a filename inside a path
                // string can collide with a symbol and wrong-jump there. Never run it on string
                // content - providers navigate their own path strings via definition() above.
                if (symbol && !registry.isPositionInString(langId, text, params.position)) {
                    return registry.symbolDefinition(langId, symbol);
                }

                return null;
            },
            ctx.timingOpts,
        ),
    );
}
