import { conlog } from "../common";
import { registry } from "../provider-registry";
import { tryGetServerContext, updateServerSettings } from "../server-context";
import { defaultSettings, normalizeSettings } from "../settings";
import * as documentLifecycleHandler from "./document-lifecycle";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onDidChangeConfiguration(async (change) => {
        conlog("did change configuration");
        // LSP event ordering is uncertain — this may fire before onInitialized completes.
        const serverCtx = tryGetServerContext();
        if (!serverCtx) {
            return;
        }
        if (serverCtx.capabilities.configuration) {
            documentLifecycleHandler.clearDocumentSettings();
            const freshSettings = normalizeSettings(
                await ctx.connection.workspace.getConfiguration({ section: "bgforge" }),
            );
            updateServerSettings(freshSettings);
            registry.updateSettings(freshSettings);
        } else {
            // change.settings is typed as any by vscode-languageserver
            const bgforge = change.settings?.bgforge as unknown;
            const freshSettings = normalizeSettings(bgforge ?? defaultSettings);
            updateServerSettings(freshSettings);
            registry.updateSettings(freshSettings);
        }
    });

    ctx.connection.onDidChangeWatchedFiles((params) => {
        // Each handleWatchedFileChange call is async — fan out in parallel and
        // let the LSP event loop continue immediately. Errors are logged inside
        // the handler; we surface unexpected promise rejections via conlog.
        for (const event of params.changes) {
            registry.handleWatchedFileChange(event.uri, event.type).catch((error: unknown) => {
                conlog(
                    `handleWatchedFileChange rejected: ${error instanceof Error ? error.message : String(error)}`,
                    "warn",
                );
            });
        }
    });
}
