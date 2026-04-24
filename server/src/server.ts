/**
 * LSP server entry point.
 * Sets up the language server connection and routes all LSP requests
 * to the appropriate providers via ProviderRegistry.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
} from "vscode-languageserver/node";
import { type NormalizedUri } from "./core/normalized-uri";
import { makeTimingOptions } from "./shared/time-handler";
import { initLspConnection } from "./lsp-connection";
import { initSettingsService } from "./settings-service";
import { UriDebouncer } from "./core/uri-debouncer";
import type { HandlerContext } from "./handlers/context";
import { createRenameSuppression } from "./handlers/rename-suppression";
import * as initializeHandler from "./handlers/initialize";
import * as completionHandler from "./handlers/completion";
import * as configHandler from "./handlers/config";
import * as definitionHandler from "./handlers/definition";
import * as foldingHandler from "./handlers/folding";
import * as formattingHandler from "./handlers/formatting";
import * as hoverHandler from "./handlers/hover";
import * as inlayHintsHandler from "./handlers/inlay-hints";
import * as referencesHandler from "./handlers/references";
import * as semanticTokensHandler from "./handlers/semantic-tokens";
import * as signatureHandler from "./handlers/signature";
import * as symbolsHandler from "./handlers/symbols";
import * as renameHandler from "./handlers/rename";
import * as documentLifecycleHandler from "./handlers/document-lifecycle";
import * as executeCommandHandler from "./handlers/execute-command";

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

const getDocumentSettings = documentLifecycleHandler.makeGetDocumentSettings(connection);

// Initialize the settings service holder so compile.ts can access settings without importing server.ts
initSettingsService(getDocumentSettings);

const renameSuppression = createRenameSuppression();

const handlerCtx: HandlerContext = {
    connection,
    documents,
    timingOpts,
    fileReloadDebouncer,
    compileDebouncer,
    renameSuppression,
    getDocumentSettings,
};

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();

initializeHandler.register(handlerCtx);
completionHandler.register(handlerCtx);
configHandler.register(handlerCtx);
hoverHandler.register(handlerCtx);

executeCommandHandler.register(handlerCtx);

signatureHandler.register(handlerCtx);

documentLifecycleHandler.register(handlerCtx);

inlayHintsHandler.register(handlerCtx);

definitionHandler.register(handlerCtx);

referencesHandler.register(handlerCtx);

renameHandler.register(handlerCtx);

// Clean up timers on shutdown
connection.onShutdown(() => {
    handlerCtx.renameSuppression.dispose();
    fileReloadDebouncer.dispose();
    compileDebouncer.dispose();
});

formattingHandler.register(handlerCtx);

symbolsHandler.register(handlerCtx);

semanticTokensHandler.register(handlerCtx);

foldingHandler.register(handlerCtx);
