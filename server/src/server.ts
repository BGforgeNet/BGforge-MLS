/**
 * LSP server entry point.
 * Sets up the language server connection and routes all LSP requests
 * to the appropriate providers via ProviderRegistry.
 */

import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    type CompletionParams,
    type InitializeParams,
    type InitializeResult,
    type TextDocumentPositionParams,
    CompletionItem,
    createConnection,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
    MessageType,
    ProposedFeatures,
    TextDocuments,
    TextDocumentEdit,
} from "vscode-languageserver/node";
import { conlog, symbolAtPosition } from "./common";
import { isHeaderFile } from "./core/location-utils";
import { type NormalizedUri, normalizeUri } from "./core/normalized-uri";
import { decodeFileUris, showInfo } from "./user-messages";
import { clearDiagnostics, COMMAND_compile, compile } from "./compile";
import { getRequest as getSignatureRequest } from "./shared/signature";
import { makeTimingOptions, timeHandler } from "./shared/time-handler";
import { parseDialog } from "./dialog";
import { parseTDDialog } from "./td/dialog";
import { parseTSSLDialog } from "./tssl/dialog";
import { parseDDialog } from "./weidu-d/dialog";
import { falloutSslProvider } from "./fallout-ssl/provider";
import { Translation } from "./translation";
import {
    EXT_TD,
    EXT_TSSL,
    LANG_FALLOUT_MSG,
    LANG_FALLOUT_SCRIPTS_LST,
    LANG_FALLOUT_SSL,
    LANG_TYPESCRIPT,
    LANG_WEIDU_BAF,
    LANG_WEIDU_D,
    LANG_WEIDU_LOG,
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TRA,
    LANG_WEIDU_TP2,
} from "./core/languages";
import { getDefinition as getWeiduLogDefinition } from "./weidu-log/definition";
import { infinity2daProvider } from "./infinity-2da/provider";
import { createFormatOnlyProvider } from "./core/format-only-provider";
import { formatTra } from "./weidu-tra/format";
import { formatMsg } from "./fallout-msg/format";
import { formatScriptsLst } from "./fallout-scripts-lst/format";
import { falloutWorldmapProvider } from "./fallout-worldmap/provider";
import { parserManager } from "./core/parser-manager";
import { registry } from "./provider-registry";
import * as settings from "./settings";
import {
    type MLSsettings,
    defaultSettings,
    normalizeSettings,
    shouldValidateOnChange,
    shouldValidateOnSave,
} from "./settings";
import { weiduBafProvider } from "./weidu-baf/provider";
import { weiduDProvider } from "./weidu-d/provider";
import { weiduTp2Provider } from "./weidu-tp2/provider";
import { initLspConnection } from "./lsp-connection";
import { initServerContext, getServerContext, tryGetServerContext, updateServerSettings } from "./server-context";
import { initSettingsService } from "./settings-service";
import { getServerCapabilities } from "./server-capabilities";
import { UriDebouncer } from "./core/uri-debouncer";
import { LSP_COMMAND_PARSE_DIALOG, NOTIFICATION_LOAD_FINISHED, VSCODE_COMMAND_COMPILE } from "../../shared/protocol";

// Create a connection for the server.
// createConnection() auto-detects transport from process.argv:
// --stdio, --node-ipc, --pipe, or --socket=N. Defaults to IPC when
// launched by VSCode, stdio when launched standalone.
const connection = createConnection(ProposedFeatures.all);

// Timing options for request latency logging. Built once so the warn closure
// always references the live connection console.
const timingOpts = makeTimingOptions(connection.console);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Initialize the LSP connection holder for modules that need it
initLspConnection(connection, documents);

// Debouncing for file data reloads on content changes.
// Uses NormalizedUri keys to ensure consistent matching regardless of URI encoding.
const RELOAD_DEBOUNCE_MS = 300;
const fileReloadDebouncer = new UriDebouncer<NormalizedUri>(RELOAD_DEBOUNCE_MS);

// Debouncing for validate-on-type to avoid rapid-fire compilations.
// Without this, every keystroke with validate="type"/"saveAndType" would spawn a new
// compiler process. This is especially problematic for SSL compilation which
// writes a shared .tmp.ssl file — concurrent compilations corrupt each other.
const COMPILE_DEBOUNCE_MS = 300;
const compileDebouncer = new UriDebouncer<NormalizedUri>(COMPILE_DEBOUNCE_MS);

/** Log and swallow compile errors for fire-and-forget call sites. */
function logCompileError(err: unknown) {
    conlog(`Compilation error: ${err}`);
}

// Capability flags captured in onInitialize, consumed in onInitialized.
// Plain object so both handlers share a reference without module-level lets.
const capabilityFlags = {
    configuration: false,
    workspaceFolders: false,
    fileWatching: false,
};

// Workspace root captured in onInitialize, consumed in onInitialized.
let workspaceRoot: string | undefined;

connection.onInitialize(async (params: InitializeParams): Promise<InitializeResult> => {
    conlog("onInitialize started");
    const caps = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    capabilityFlags.configuration = Boolean(caps.workspace?.configuration);
    capabilityFlags.workspaceFolders = Boolean(caps.workspace?.workspaceFolders);
    capabilityFlags.fileWatching = Boolean(caps.workspace?.didChangeWatchedFiles?.dynamicRegistration);

    if (params.workspaceFolders?.[0]) {
        workspaceRoot = fileURLToPath(params.workspaceFolders[0].uri);
        conlog(`workspace_root = ${workspaceRoot}`);
    }

    // Load data and initialize parsers/providers here so the server is fully
    // ready before the initialize response is sent. This closes the race window
    // where onInitialized's async setup had not yet finished but the client was
    // already firing requests (e.g. textDocument/inlayHint).
    const projectSettings = settings.project(workspaceRoot);

    // Initialize translation service
    const translation = new Translation(projectSettings.translation, workspaceRoot);
    await translation.init();

    // Register tree-sitter parsers and initialize them sequentially
    // (web-tree-sitter's shared TRANSFER_BUFFER requires sequential Language.load())
    parserManager.register(LANG_FALLOUT_SSL, "tree-sitter-ssl.wasm", "SSL");
    parserManager.register(LANG_WEIDU_BAF, "tree-sitter-baf.wasm", "BAF");
    parserManager.register(LANG_WEIDU_D, "tree-sitter-weidu_d.wasm", "WeiDU D");
    parserManager.register(LANG_WEIDU_TP2, "tree-sitter-weidu_tp2.wasm", "WeiDU TP2");
    await parserManager.initAll();

    // Register and initialize providers
    registry.register(falloutSslProvider);
    registry.register(falloutWorldmapProvider);
    registry.register(weiduBafProvider);
    registry.register(weiduDProvider);
    registry.register(weiduTp2Provider);
    registry.register({
        id: LANG_WEIDU_LOG,
        async init(): Promise<void> {
            conlog(`${LANG_WEIDU_LOG} provider initialized`);
        },
        definition(text, position, uri) {
            return getWeiduLogDefinition(text, uri, position);
        },
    });
    registry.register(infinity2daProvider);
    registry.register(createFormatOnlyProvider(LANG_WEIDU_TRA, formatTra));
    registry.register(createFormatOnlyProvider(LANG_FALLOUT_MSG, formatMsg));
    registry.register(createFormatOnlyProvider(LANG_FALLOUT_SCRIPTS_LST, formatScriptsLst));

    // Register language aliases (languages that share data with parent providers)
    registry.registerAlias(LANG_WEIDU_SLB, LANG_WEIDU_BAF);
    registry.registerAlias(LANG_WEIDU_SSL, LANG_WEIDU_BAF);

    await registry.init({
        workspaceRoot,
        settings: defaultSettings,
        getDocumentText: (uri) => documents.get(uri)?.getText(),
    });

    initServerContext({
        capabilities: {
            configuration: capabilityFlags.configuration,
            workspaceFolders: capabilityFlags.workspaceFolders,
            fileWatching: capabilityFlags.fileWatching,
        },
        workspaceRoot,
        projectSettings,
        settings: defaultSettings,
        translation,
    });

    // Reload translation files for any documents already open
    for (const document of documents.all()) {
        translation.reloadFile(document.uri, document.languageId, document.getText());
    }

    const result: InitializeResult = {
        capabilities: getServerCapabilities(),
    };
    if (capabilityFlags.workspaceFolders) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
            },
        };
    }
    conlog("onInitialize completed");
    return result;
});

connection.onInitialized(async () => {
    conlog("onInitialized started");
    if (capabilityFlags.configuration) {
        // Register for all configuration changes.
        await connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }

    // Fetch the real user settings now that the client is ready to respond,
    // and push them to both the context and the provider registry.
    const freshSettings = normalizeSettings(await connection.workspace.getConfiguration({ section: "bgforge" }));
    updateServerSettings(freshSettings);
    registry.updateSettings(freshSettings);

    // Register file watchers for header files
    // NOTE: For standalone LSP usage (e.g., Claude Code) where client may not support
    // file watching, consider adding chokidar-based fallback in the future.
    if (capabilityFlags.fileWatching) {
        const watchPatterns = registry.getWatchPatterns();
        if (watchPatterns.length > 0) {
            await connection.client.register(DidChangeWatchedFilesNotification.type, {
                watchers: watchPatterns,
            });
            conlog(`Registered file watchers for ${watchPatterns.length} patterns`);
        }
    }

    void connection.sendNotification(NOTIFICATION_LOAD_FINISHED);
    conlog("onInitialized completed");
});

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<MLSsettings>> = new Map();

connection.onDidChangeConfiguration(async (change) => {
    conlog("did change configuration");
    // LSP event ordering is uncertain — this may fire before onInitialized completes.
    const serverCtx = tryGetServerContext();
    if (!serverCtx) {
        return;
    }
    if (serverCtx.capabilities.configuration) {
        // Reset all cached document settings
        documentSettings.clear();
        // Fetch fresh global settings and push to providers (e.g., debug flag)
        const freshSettings = normalizeSettings(await connection.workspace.getConfiguration({ section: "bgforge" }));
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

// Handle file system changes for watched files (headers)
connection.onDidChangeWatchedFiles((params) => {
    for (const event of params.changes) {
        registry.handleWatchedFileChange(event.uri, event.type);
    }
});

// Clean up on document close
documents.onDidClose((e) => {
    documentSettings.delete(e.document.uri);
    registry.handleDocumentClosed(e.document.languageId, e.document.uri);
});

export function getDocumentSettings(resource: string): Thenable<MLSsettings> {
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
}

// Initialize the settings service holder so compile.ts can access settings without importing server.ts
initSettingsService(getDocumentSettings);

documents.onDidOpen(async (event) => {
    // Await the context barrier — covers the (now-very-small) window where
    // onInitialize's async work has not finished yet.
    const ctx = await getServerContext();

    const uri = event.document.uri;
    const langId = event.document.languageId;
    const text = event.document.getText();

    // Reload provider data
    registry.reloadFileData(langId, uri, text);

    // Reload translation data if it's a translation file
    ctx.translation.reloadFile(uri, langId, text);

    // Update consumer reverse index for consumer files
    ctx.translation.reloadConsumer(uri, text, langId);
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
    timeHandler(
        "onCompletion",
        (params: CompletionParams) => {
            const uri = params.textDocument.uri;
            const textDoc = documents.get(uri);
            if (!textDoc) {
                return [];
            }
            const langId = textDoc.languageId;
            const text = textDoc.getText();
            return registry.completion(langId, text, uri, params.position, params.context?.triggerCharacter);
        },
        timingOpts,
    ),
);

// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
    return item;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

connection.onHover(
    timeHandler(
        "onHover",
        async (textDocumentPosition: TextDocumentPositionParams) => {
            const uri = textDocumentPosition.textDocument.uri;
            const textDoc = documents.get(uri);
            if (!textDoc) {
                return;
            }
            const langId = textDoc.languageId;
            const text = textDoc.getText();
            const symbol = symbolAtPosition(text, textDocumentPosition.position);
            const ctx = await getServerContext();
            const { debug } = ctx.settings;

            if (!symbol) {
                if (debug) conlog(`[hover] no symbol at position in ${uri}`);
                return;
            }

            if (debug) conlog(`[hover] symbol="${symbol}" langId="${langId}" uri="${uri}"`);

            // Suppress all features in comment zones
            if (!registry.shouldProvideFeatures(langId, text, textDocumentPosition.position)) {
                if (debug) conlog(`[hover] suppressed (shouldProvideFeatures=false)`);
                return;
            }

            // Check translation hover first (for @123 or NOption(123) references)
            const translationHover = ctx.translation.getHover(uri, langId, symbol, text);
            if (translationHover) {
                if (debug) conlog(`[hover] translation hover returned`);
                return translationHover;
            }

            // Try local hover (AST-based, for symbols defined in current file)
            const localHover = registry.localHover(langId, text, symbol, uri, textDocumentPosition.position);
            if (localHover.handled) {
                if (debug) conlog(`[hover] localHover handled, result=${localHover.hover ? "found" : "null"}`);
                return localHover.hover;
            }

            // Fall back to data-driven hover (from headers/static data)
            // Pass text to enable unified symbol resolution (Approach C)
            const dataHover = registry.hover(langId, uri, symbol, text);
            if (debug) conlog(`[hover] dataHover result=${dataHover ? "found" : "null"}`);
            return dataHover;
        },
        timingOpts,
    ),
);

/** Dialog preview handler registry. Maps language/extension to parser + translation language. */
const dialogHandlers = [
    {
        match: (langId: string, _uri: string) => langId === LANG_FALLOUT_SSL,
        parse: (_uri: string, text: string) => parseDialog(text),
        translationLangId: LANG_FALLOUT_SSL,
    },
    {
        match: (langId: string, _uri: string) => langId === LANG_WEIDU_D,
        parse: (_uri: string, text: string) => Promise.resolve(parseDDialog(text)),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TD),
        parse: (uri: string, text: string) => parseTDDialog(uri, text),
        translationLangId: LANG_WEIDU_D,
    },
    {
        match: (langId: string, uri: string) => langId === LANG_TYPESCRIPT && uri.endsWith(EXT_TSSL),
        parse: (uri: string, text: string) => parseTSSLDialog(uri, text),
        translationLangId: LANG_FALLOUT_SSL,
    },
];

connection.onExecuteCommand(async (params) => {
    const command = params.command;
    if (!params.arguments) {
        return;
    }
    const args = params.arguments[0];

    // Handle parseDialog command
    if (command === LSP_COMMAND_PARSE_DIALOG) {
        const uri: string = args.uri;
        const textDoc = documents.get(uri);
        if (!textDoc) {
            return null;
        }
        try {
            const langId = textDoc.languageId;
            const text = textDoc.getText();
            const lowerUri = uri.toLowerCase();

            // Each entry: match condition, parse function, translation language
            const handler = dialogHandlers.find((h) => h.match(langId, lowerUri));
            if (!handler) {
                return null;
            }
            const dialogData = await handler.parse(uri, text);
            const ctx = await getServerContext();
            const messages = ctx.translation.getMessages(uri, text, handler.translationLangId);
            return { ...dialogData, messages };
        } catch (e) {
            conlog("parseDialog error: " + e);
            if (e instanceof Error) {
                conlog("stack: " + e.stack);
            }
            return null;
        }
    }

    if (command !== COMMAND_compile && command !== VSCODE_COMMAND_COMPILE) {
        return;
    }

    const uri = typeof args.uri === "string" ? args.uri : undefined;
    if (!uri || !uri.startsWith("file://")) {
        conlog(`Compile: invalid non-file uri '${String(uri)}'`);
        showInfo("Focus a valid file to run commands!");
        return;
    }

    const textDoc = documents.get(uri);
    if (!textDoc) {
        return;
    }
    const langId = textDoc.languageId;
    const text = textDoc.getText();

    void compile(uri, langId, true, text).catch(logCompileError);
    return undefined;
});

connection.onSignatureHelp((params) => {
    const uri = params.textDocument.uri;
    const document = documents.get(uri);
    if (!document) {
        return null;
    }
    const text = document.getText();
    const langId = document.languageId;

    // Parse signature request from text/position
    const request = getSignatureRequest(text, params.position);
    if (!request) {
        return null;
    }

    return registry.signature(langId, text, uri, request.symbol, request.parameter);
});

documents.onDidSave(async (change) => {
    const uri = change.document.uri;
    const langId = change.document.languageId;
    const text = change.document.getText();

    // Reload provider data
    registry.reloadFileData(langId, uri, text);

    // Header changes can affect semantic tokens in other files
    // (e.g., @type {resref} annotations define resref highlighting).
    if (isHeaderFile(uri)) {
        connection.languages.semanticTokens.refresh();
    }

    // Reload translation data if it's a translation file
    tryGetServerContext()?.translation.reloadFile(uri, langId, text);

    // Update consumer reverse index for consumer files
    tryGetServerContext()?.translation.reloadConsumer(uri, text, langId);

    const normUri = normalizeUri(uri);

    // Skip compile for files touched by a recent multi-file rename.
    // Remove the URI so subsequent saves compile normally.
    if (renameAffectedUris.delete(normUri)) {
        return;
    }

    const docSettings = await getDocumentSettings(uri);
    const validate = docSettings.validate;
    if (shouldValidateOnSave(validate)) {
        // Cancel any pending debounced compile for this URI — save takes priority
        // and must not race with a stale onDidChangeContent compilation.
        compileDebouncer.cancel(normUri);
        void compile(uri, langId, false, text).catch(logCompileError);
    }
});

documents.onDidChangeContent(async (event) => {
    const uri = event.document.uri;
    const langId = event.document.languageId;
    const text = event.document.getText();

    const normUri = normalizeUri(uri);

    // Keep provider data (function index, etc.) and translation data up to date as content changes.
    // This ensures hover/definition work immediately after edits like rename.
    // Debounced to avoid excessive reloads during rapid typing.
    fileReloadDebouncer.schedule(normUri, () => {
        registry.reloadFileData(langId, uri, text);
        tryGetServerContext()?.translation.reloadFile(uri, langId, text);
        tryGetServerContext()?.translation.reloadConsumer(uri, text, langId);
        if (isHeaderFile(uri)) {
            connection.languages.semanticTokens.refresh();
        }
    });

    // Skip compile for files touched by a recent multi-file rename.
    // Keep the URI in the set — onDidSave will remove it after the final skip.
    if (renameAffectedUris.has(normUri)) {
        return;
    }

    clearDiagnostics(uri);

    const docSettings = await getDocumentSettings(uri);
    const validate = docSettings.validate;
    if (shouldValidateOnChange(validate)) {
        compileDebouncer.schedule(normUri, () => {
            void compile(uri, langId, false, text).catch(logCompileError);
        });
    }
});

connection.languages.inlayHint.on(async (params) => {
    const uri = params.textDocument.uri;
    const document = documents.get(uri);
    if (!document) {
        return;
    }
    const text = document.getText();
    const langId = document.languageId;

    // Try provider first (for AST-based inlay hints)
    const providerResult = registry.inlayHints(langId, text, uri, params.range);
    if (providerResult.length > 0) {
        return providerResult;
    }

    // Fall back to translation-based inlay hints
    const ctx = await getServerContext();
    return ctx.translation.getInlayHints(uri, langId, text, params.range);
});

connection.onDefinition(
    timeHandler(
        "onDefinition",
        async (params) => {
            const textDoc = documents.get(params.textDocument.uri);
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
            const providerResult = registry.definition(langId, text, params.position, uri);
            if (providerResult) {
                return providerResult;
            }

            const symbol = symbolAtPosition(text, params.position);
            const ctx = await getServerContext();

            // Try translation definition (mstr/tra/@123 references -> .msg/.tra files)
            if (symbol) {
                const traResult = ctx.translation.getDefinition(uri, langId, symbol, text);
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
        timingOpts,
    ),
);

connection.onReferences(
    timeHandler(
        "onReferences",
        async (params, token) => {
            const textDoc = documents.get(params.textDocument.uri);
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
            const ctx = await getServerContext();
            const traResult = ctx.translation.getReferences(
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
        timingOpts,
    ),
);

connection.onPrepareRename((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return null;
    }
    const langId = textDoc.languageId;
    const text = textDoc.getText();

    return registry.prepareRename(langId, text, params.position);
});

// URIs touched by the most recent multi-file rename. Compile is suppressed for
// these files in both onDidChangeContent and onDidSave to avoid breaking VS Code's
// cross-file undo group (compile writes .tmp.ssl which triggers file watchers that
// invalidate the undo group). A safety timeout clears the set in case some files
// never trigger change/save events (e.g. user undoes before save).
const RENAME_SUPPRESS_MS = 3000;
const renameAffectedUris = new Set<NormalizedUri>();
let renameSuppressTimer: NodeJS.Timeout | undefined;

connection.onRenameRequest((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return null;
    }
    const uri = params.textDocument.uri;
    const langId = textDoc.languageId;
    const text = textDoc.getText();

    const result = registry.rename(langId, text, params.position, params.newName, uri);

    // Track affected URIs so onDidChangeContent/onDidSave skip compile for them
    if (result?.documentChanges && result.documentChanges.length > 0) {
        renameAffectedUris.clear();
        for (const dc of result.documentChanges) {
            if (TextDocumentEdit.is(dc)) {
                renameAffectedUris.add(normalizeUri(dc.textDocument.uri));
            }
        }
        // Safety cleanup in case some URIs never trigger change/save
        if (renameSuppressTimer) clearTimeout(renameSuppressTimer);
        renameSuppressTimer = setTimeout(() => {
            renameAffectedUris.clear();
        }, RENAME_SUPPRESS_MS);
    }

    return result;
});

// Clean up timers on shutdown
connection.onShutdown(() => {
    if (renameSuppressTimer) clearTimeout(renameSuppressTimer);
    fileReloadDebouncer.dispose();
    compileDebouncer.dispose();
});

connection.onDocumentFormatting((params) => {
    const textDoc = documents.get(params.textDocument.uri);
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
        void connection.sendNotification("window/showMessage", {
            type: MessageType.Warning,
            message: decodeFileUris(result.warning),
        });
    }
    return result.edits;
});

connection.onDocumentSymbol(
    timeHandler(
        "onDocumentSymbol",
        (params) => {
            const textDoc = documents.get(params.textDocument.uri);
            if (!textDoc) {
                return [];
            }
            return registry.symbols(textDoc.languageId, textDoc.getText());
        },
        timingOpts,
    ),
);

connection.languages.semanticTokens.on(
    timeHandler(
        "semanticTokens",
        (params) => {
            const textDoc = documents.get(params.textDocument.uri);
            if (!textDoc) {
                return { data: [] };
            }

            return registry.semanticTokens(textDoc.languageId, textDoc.getText(), params.textDocument.uri);
        },
        timingOpts,
    ),
);

connection.onWorkspaceSymbol(
    timeHandler(
        "onWorkspaceSymbol",
        (params, token) => {
            return registry.workspaceSymbols(params.query, token);
        },
        timingOpts,
    ),
);

connection.onFoldingRanges((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return [];
    }
    return registry.foldingRanges(textDoc.languageId, textDoc.getText());
});
