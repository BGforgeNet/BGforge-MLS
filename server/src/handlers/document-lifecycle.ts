import type { Connection } from "vscode-languageserver/node";
import { isHeaderFile } from "../core/location-utils";
import { normalizeUri } from "../core/normalized-uri";
import { conlog } from "../common";
import { registry } from "../provider-registry";
import { getServerContext, tryGetServerContext } from "../server-context";
import { compile, clearDiagnostics } from "../compile";
import {
    type MLSsettings,
    defaultSettings,
    normalizeSettings,
    shouldValidateOnChange,
    shouldValidateOnSave,
} from "../settings";
import type { HandlerContext } from "./context";

const documentSettings: Map<string, Thenable<MLSsettings>> = new Map();

/** Log and swallow compile errors for fire-and-forget call sites. */
function logCompileError(err: unknown) {
    conlog(`Compilation error: ${err}`);
}

/**
 * Build the `getDocumentSettings` function used by compile.ts and the
 * document-lifecycle handlers. Returns a bound function keyed on the server's
 * connection so it can fetch scoped bgforge settings when the client supports
 * `workspace/configuration`.
 */
export function makeGetDocumentSettings(connection: Connection): (resource: string) => Thenable<MLSsettings> {
    return (resource: string) => {
        const serverCtx = tryGetServerContext();
        if (!serverCtx?.capabilities.configuration) {
            return Promise.resolve(serverCtx?.settings ?? defaultSettings);
        }
        let result = documentSettings.get(resource);
        if (!result) {
            result = connection.workspace
                .getConfiguration({
                    scopeUri: resource,
                    section: "bgforge",
                })
                .then(normalizeSettings);
            documentSettings.set(resource, result);
        }
        return result;
    };
}

/** Drop every cached document setting. Called by the config-change handler when capabilities.configuration. */
export function clearDocumentSettings(): void {
    documentSettings.clear();
}

export function register(ctx: HandlerContext): void {
    ctx.documents.onDidClose((e) => {
        documentSettings.delete(e.document.uri);
        registry.handleDocumentClosed(e.document.languageId, e.document.uri);
    });

    ctx.documents.onDidOpen(async (event) => {
        // Await the context barrier — covers the (now-very-small) window where
        // onInitialize's async work has not finished yet.
        const serverCtx = await getServerContext();

        const uri = event.document.uri;
        const langId = event.document.languageId;
        const text = event.document.getText();

        registry.reloadFileData(langId, uri, text);
        serverCtx.translation.reloadFile(uri, langId, text);
        serverCtx.translation.reloadConsumer(uri, text, langId);
    });

    ctx.documents.onDidSave(async (change) => {
        const uri = change.document.uri;
        const langId = change.document.languageId;
        const text = change.document.getText();

        registry.reloadFileData(langId, uri, text);

        // Header changes can affect semantic tokens in other files
        // (e.g., @type {resref} annotations define resref highlighting).
        if (isHeaderFile(uri)) {
            ctx.connection.languages.semanticTokens.refresh();
        }

        tryGetServerContext()?.translation.reloadFile(uri, langId, text);
        tryGetServerContext()?.translation.reloadConsumer(uri, text, langId);

        const normUri = normalizeUri(uri);

        // Skip compile for files touched by a recent multi-file rename.
        if (ctx.renameSuppression.consumeAffected(normUri)) {
            return;
        }

        const docSettings = await ctx.getDocumentSettings(uri);
        if (shouldValidateOnSave(docSettings.validate)) {
            // Cancel any pending debounced compile for this URI — save takes priority
            // and must not race with a stale onDidChangeContent compilation.
            ctx.compileDebouncer.cancel(normUri);
            void compile(uri, langId, false, text).catch(logCompileError);
        }
    });

    ctx.documents.onDidChangeContent(async (event) => {
        const uri = event.document.uri;
        const langId = event.document.languageId;
        const text = event.document.getText();
        const normUri = normalizeUri(uri);

        // Keep provider data (function index, etc.) and translation data up to date as content changes.
        // This ensures hover/definition work immediately after edits like rename.
        // Debounced to avoid excessive reloads during rapid typing.
        ctx.fileReloadDebouncer.schedule(normUri, () => {
            registry.reloadFileData(langId, uri, text);
            tryGetServerContext()?.translation.reloadFile(uri, langId, text);
            tryGetServerContext()?.translation.reloadConsumer(uri, text, langId);
            if (isHeaderFile(uri)) {
                ctx.connection.languages.semanticTokens.refresh();
            }
        });

        // Skip compile for files touched by a recent multi-file rename.
        if (ctx.renameSuppression.isAffected(normUri)) {
            return;
        }

        clearDiagnostics(uri);

        const docSettings = await ctx.getDocumentSettings(uri);
        if (shouldValidateOnChange(docSettings.validate)) {
            ctx.compileDebouncer.schedule(normUri, () => {
                void compile(uri, langId, false, text).catch(logCompileError);
            });
        }
    });
}
