import type { CancellationToken } from "vscode-languageserver/node";
import { timeHandler } from "../shared/time-handler";
import { registry } from "../provider-registry";
import { getServerContext } from "../server-context";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onReferences(
        timeHandler(
            "onReferences",
            async (params, token: CancellationToken) => {
                const textDoc = ctx.documents.get(params.textDocument.uri);
                if (!textDoc) {
                    return [];
                }
                const uri = params.textDocument.uri;
                const langId = textDoc.languageId;
                const text = textDoc.getText();

                // Suppress features in comment/param-name zones
                if (!registry.shouldProvideFeatures(langId, text, params.position)) {
                    return [];
                }

                // Try provider references first (AST-based, e.g. variable/function references)
                const providerResult = registry.references(
                    langId,
                    text,
                    params.position,
                    uri,
                    params.context.includeDeclaration,
                    token,
                );
                if (providerResult.length > 0) {
                    return providerResult;
                }

                // Try translation references (for tra/msg files — find usages across consumer files)
                // Translation lookup is a single-file index lookup — bounded work, no token check needed.
                const serverCtx = await getServerContext();
                const traResult = await serverCtx.translation.getReferences(
                    uri,
                    langId,
                    params.position,
                    params.context.includeDeclaration,
                );
                if (traResult && traResult.length > 0) {
                    return traResult;
                }

                return [];
            },
            ctx.timingOpts,
        ),
    );
}
