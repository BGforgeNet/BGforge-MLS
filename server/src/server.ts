/**
 * LSP server entry point.
 * Sets up the language server connection and routes all LSP requests
 * to the appropriate providers via ProviderRegistry.
 */

import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
    CompletionItem,
    CompletionParams,
    createConnection,
    DidChangeConfigurationNotification,
    DidChangeWatchedFilesNotification,
    InitializeParams,
    InitializeResult,
    MessageType,
    ProposedFeatures,
    TextDocumentPositionParams,
    TextDocuments,
    TextDocumentEdit,
} from "vscode-languageserver/node";
import { conlog, symbolAtPosition } from "./common";
import { isHeaderFile } from "./core/location-utils";
import { type NormalizedUri, normalizeUri } from "./core/normalized-uri";
import { decodeFileUris, showInfo } from "./user-messages";
import { clearDiagnostics, COMMAND_compile, compile } from "./compile";
import { getRequest as getSignatureRequest } from "./shared/signature";
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
    LANG_WEIDU_SLB,
    LANG_WEIDU_SSL,
    LANG_WEIDU_TRA,
    LANG_WEIDU_TP2,
} from "./core/languages";
import { weiduLogProvider } from "./weidu-log/provider";
import { infinity2daProvider } from "./infinity-2da/provider";
import { createFormatOnlyProvider } from "./core/format-only-provider";
import { formatTra } from "./weidu-tra/format";
import { formatMsg } from "./fallout-msg/format";
import { formatScriptsLst } from "./fallout-scripts-lst/format";
import { falloutWorldmapProvider } from "./fallout-worldmap/provider";
import { parserManager } from "./core/parser-manager";
import { registry } from "./provider-registry";
import * as settings from "./settings";
import { defaultSettings, MLSsettings, normalizeSettings, shouldValidateOnChange, shouldValidateOnSave } from "./settings";
import { weiduBafProvider } from "./weidu-baf/provider";
import { weiduDProvider } from "./weidu-d/provider";
import { weiduTp2Provider } from "./weidu-tp2/provider";
import { initLspConnection } from "./lsp-connection";
import { initSettingsService } from "./settings-service";
import { getServerCapabilities } from "./server-capabilities";
import { UriDebouncer } from "./core/uri-debouncer";
import {
    LSP_COMMAND_PARSE_DIALOG,
    NOTIFICATION_LOAD_FINISHED,
    VSCODE_COMMAND_COMPILE,
} from "../../shared/protocol";

// Create a connection for the server.
// createConnection() auto-detects transport from process.argv:
// --stdio, --node-ipc, --pipe, or --socket=N. Defaults to IPC when
// launched by VSCode, stdio when launched standalone.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager. The text document manager
// supports full document sync only
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Initialize the LSP connection holder for modules that need it
initLspConnection(connection, documents);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasFileWatchingCapability = false;

let workspaceRoot: string | undefined;
let projectSettings: settings.ProjectSettings;

// Initialized in onInitialized, undefined until then
let translation: Translation | undefined;

// Resolves when onInitialized completes, so handlers that depend on
// providers being ready can await it (fixes the onDidOpen race).
let resolveInitialized: () => void;
const initialized = new Promise<void>((resolve) => { resolveInitialized = resolve; });

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

connection.onInitialize((params: InitializeParams) => {
    conlog("onInitialize started");
    const capabilities = params.capabilities;
    // Does the client support the `workspace/configuration` request?
    // If not, we fall back using global settings.
    hasConfigurationCapability = !!(
        capabilities.workspace && !!capabilities.workspace.configuration
    );
    hasWorkspaceFolderCapability = !!(
        capabilities.workspace && !!capabilities.workspace.workspaceFolders
    );
    hasFileWatchingCapability = !!(
        capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration
    );

    const result: InitializeResult = {
        capabilities: getServerCapabilities(),
    };
    if (hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
            workspaceFolders: {
                supported: true,
            },
        };
    }
    if (params.workspaceFolders?.[0]) {
        workspaceRoot = fileURLToPath(params.workspaceFolders[0].uri);
        conlog(`workspace_root = ${workspaceRoot}`);
    }
    conlog("onInitialize completed");
    return result;
});

export let globalSettings: MLSsettings = defaultSettings;

connection.onInitialized(async () => {
    conlog("onInitialized started");
    if (hasConfigurationCapability) {
        // Register for all configuration changes.
        await connection.client.register(DidChangeConfigurationNotification.type, undefined);
    }
    globalSettings = normalizeSettings(await connection.workspace.getConfiguration({ section: "bgforge" }));
    // load data
    projectSettings = settings.project(workspaceRoot);

    // Initialize translation service
    translation = new Translation(projectSettings.translation, workspaceRoot);
    await translation.init();

    // Reload translation files for open documents
    for (const document of documents.all()) {
        translation.reloadFile(document.uri, document.languageId, document.getText());
    }
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
    registry.register(weiduLogProvider);
    registry.register(infinity2daProvider);
    registry.register(createFormatOnlyProvider(LANG_WEIDU_TRA, formatTra));
    registry.register(createFormatOnlyProvider(LANG_FALLOUT_MSG, formatMsg));
    registry.register(createFormatOnlyProvider(LANG_FALLOUT_SCRIPTS_LST, formatScriptsLst));

    // Register language aliases (languages that share data with parent providers)
    registry.registerAlias(LANG_WEIDU_SLB, LANG_WEIDU_BAF);
    registry.registerAlias(LANG_WEIDU_SSL, LANG_WEIDU_BAF);

    await registry.init({
        workspaceRoot,
        settings: globalSettings,
        getDocumentText: (uri) => documents.get(uri)?.getText(),
    });

    // Register file watchers for header files
    // NOTE: For standalone LSP usage (e.g., Claude Code) where client may not support
    // file watching, consider adding chokidar-based fallback in the future.
    if (hasFileWatchingCapability) {
        const watchPatterns = registry.getWatchPatterns();
        if (watchPatterns.length > 0) {
            await connection.client.register(DidChangeWatchedFilesNotification.type, {
                watchers: watchPatterns,
            });
            conlog(`Registered file watchers for ${watchPatterns.length} patterns`);
        }
    }

    resolveInitialized();
    void connection.sendNotification(NOTIFICATION_LOAD_FINISHED);
    conlog("onInitialized completed");
});

// Cache the settings of all open documents
const documentSettings: Map<string, Thenable<MLSsettings>> = new Map();

connection.onDidChangeConfiguration(async (change) => {
    conlog("did change configuration");
    if (hasConfigurationCapability) {
        // Reset all cached document settings
        documentSettings.clear();
        // Fetch fresh global settings and push to providers (e.g., debug flag)
        const freshSettings = normalizeSettings(await connection.workspace.getConfiguration({ section: "bgforge" }));
        globalSettings = freshSettings;
        registry.updateSettings(freshSettings);
    } else {
        // change.settings is typed as any by vscode-languageserver
        const bgforge = change.settings?.bgforge as unknown;
        globalSettings = normalizeSettings(bgforge ?? defaultSettings);
        registry.updateSettings(globalSettings);
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
    if (!hasConfigurationCapability) {
        return Promise.resolve(globalSettings);
    }
    let result = documentSettings.get(resource);
    if (!result) {
        result = connection.workspace.getConfiguration({
            scopeUri: resource,
            section: "bgforge",
        }).then(normalizeSettings);
        documentSettings.set(resource, result);
    }
    return result;
}

// Initialize the settings service holder so compile.ts can access settings without importing server.ts
initSettingsService(getDocumentSettings);

documents.onDidOpen(async (event) => {
    // Wait for providers to be ready before processing the first open document.
    // Without this, the first document opened at startup fires before onInitialized completes.
    await initialized;

    const uri = event.document.uri;
    const langId = event.document.languageId;
    const text = event.document.getText();

    // Reload provider data
    registry.reloadFileData(langId, uri, text);

    // Reload translation data if it's a translation file
    translation?.reloadFile(uri, langId, text);

    // Update consumer reverse index for consumer files
    translation?.reloadConsumer(uri, text, langId);
});

// This handler provides the initial list of the completion items.
connection.onCompletion((params: CompletionParams) => {
    const uri = params.textDocument.uri;
    const textDoc = documents.get(uri);
    if (!textDoc) {
        return [];
    }
    const langId = textDoc.languageId;
    const text = textDoc.getText();
    return registry.completion(langId, text, uri, params.position, params.context?.triggerCharacter);
});

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

connection.onHover((textDocumentPosition: TextDocumentPositionParams) => {
    const uri = textDocumentPosition.textDocument.uri;
    const textDoc = documents.get(uri);
    if (!textDoc) {
        return;
    }
    const langId = textDoc.languageId;
    const text = textDoc.getText();
    const symbol = symbolAtPosition(text, textDocumentPosition.position);
    const debug = globalSettings.debug;

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
    const translationHover = translation?.getHover(uri, langId, symbol, text);
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
});

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
            const messages = translation?.getMessages(uri, text, handler.translationLangId) ?? {};
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
    translation?.reloadFile(uri, langId, text);

    // Update consumer reverse index for consumer files
    translation?.reloadConsumer(uri, text, langId);

    const normUri = normalizeUri(uri);

    // Skip compile for files touched by a recent multi-file rename.
    // Remove the URI so subsequent saves compile normally.
    if (renameAffectedUris.delete(normUri)) {
        return;
    }

    const validate = (await getDocumentSettings(uri)).validate;
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
        translation?.reloadFile(uri, langId, text);
        translation?.reloadConsumer(uri, text, langId);
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

    const validate = (await getDocumentSettings(uri)).validate;
    if (shouldValidateOnChange(validate)) {
        compileDebouncer.schedule(normUri, () => {
            void compile(uri, langId, false, text).catch(logCompileError);
        });
    }
});

connection.languages.inlayHint.on((params) => {
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
    return translation?.getInlayHints(uri, langId, text, params.range) ?? [];
});

connection.onDefinition((params) => {
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

    // Try translation definition (mstr/tra/@123 references -> .msg/.tra files)
    if (symbol) {
        const traResult = translation?.getDefinition(uri, langId, symbol, text);
        if (traResult) {
            return traResult;
        }
    }

    // Try provider symbol definition (data-driven, from headers)
    if (symbol) {
        return registry.symbolDefinition(langId, symbol);
    }

    return null;
});

connection.onReferences((params) => {
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
    const providerResult = registry.references(langId, text, params.position, uri, params.context.includeDeclaration);
    if (providerResult.length > 0) {
        return providerResult;
    }

    // Try translation references (for tra/msg files — find usages across consumer files)
    const traResult = translation?.getReferences(uri, langId, params.position, params.context.includeDeclaration);
    if (traResult && traResult.length > 0) {
        return traResult;
    }

    return [];
});

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
        renameSuppressTimer = setTimeout(() => { renameAffectedUris.clear(); }, RENAME_SUPPRESS_MS);
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

connection.onDocumentSymbol((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return [];
    }
    return registry.symbols(textDoc.languageId, textDoc.getText());
});

connection.languages.semanticTokens.on((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return { data: [] };
    }

    return registry.semanticTokens(textDoc.languageId, textDoc.getText(), params.textDocument.uri);
});

connection.onWorkspaceSymbol((params) => {
    return registry.workspaceSymbols(params.query);
});

connection.onFoldingRanges((params) => {
    const textDoc = documents.get(params.textDocument.uri);
    if (!textDoc) {
        return [];
    }
    return registry.foldingRanges(textDoc.languageId, textDoc.getText());
});
