/**
 * LSP server entry point.
 * Sets up the language server connection and routes all LSP requests
 * to the appropriate providers via ProviderRegistry.
 */

import { TextDocument } from "vscode-languageserver-textdocument";
import { createConnection, ProposedFeatures, TextDocuments } from "vscode-languageserver/node";
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
import * as selectionRangeHandler from "./handlers/selection-range";
import * as callHierarchyHandler from "./handlers/call-hierarchy";
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
import { abortInFlightSSLCompiles } from "./fallout-ssl/compiler";
import { stopTsslCompileWorker } from "./tssl/compile-worker-client";
import { stopTranspileWorker } from "./transpile/transpile-worker-client";
import { abortInFlightTsslCompiles } from "./tssl/compile-int";
import { abortInFlightWeiduCompiles } from "./weidu-compile";

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
// writes a shared .tmp.ssl file - concurrent compilations corrupt each other.
const COMPILE_DEBOUNCE_MS = 300;
const compileDebouncer = new UriDebouncer<NormalizedUri>(COMPILE_DEBOUNCE_MS);

// Coalescing for the in-memory diagnostic pass on a LARGE document only (see shared/parse-scheduling.ts;
// an ordinary script still parses on every keystroke). Much shorter than the two above: those wait out a
// typing burst before touching disk or spawning a compiler, where this only has to stop one keystroke's
// parse from starting before the next arrives, and the squiggles should still feel immediate.
const PARSE_DEBOUNCE_MS = 120;
const parseDebouncer = new UriDebouncer<NormalizedUri>(PARSE_DEBOUNCE_MS);

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
    parseDebouncer,
    renameSuppression,
    getDocumentSettings,
};

// Register every LSP handler before we start listening.
initializeHandler.register(handlerCtx);
configHandler.register(handlerCtx);
documentLifecycleHandler.register(handlerCtx);
executeCommandHandler.register(handlerCtx);
completionHandler.register(handlerCtx);
definitionHandler.register(handlerCtx);
foldingHandler.register(handlerCtx);
formattingHandler.register(handlerCtx);
hoverHandler.register(handlerCtx);
inlayHintsHandler.register(handlerCtx);
referencesHandler.register(handlerCtx);
renameHandler.register(handlerCtx);
selectionRangeHandler.register(handlerCtx);
callHierarchyHandler.register(handlerCtx);
semanticTokensHandler.register(handlerCtx);
signatureHandler.register(handlerCtx);
symbolsHandler.register(handlerCtx);

connection.onShutdown(() => {
    handlerCtx.renameSuppression.dispose();
    fileReloadDebouncer.dispose();
    compileDebouncer.dispose();
    parseDebouncer.dispose();
    // Detach in-flight compilers so they don't continue running after the
    // LSP transport closes. Each compiler honours the AbortSignal it was
    // started with via runProcess; aborting clears the per-URI tracking maps.
    abortInFlightSSLCompiles();
    abortInFlightWeiduCompiles();
    // The TSSL worker holds a ts-morph project and would otherwise outlive the transport it reports
    // through. Nothing awaits this: shutdown is not held up for a result no one will read.
    abortInFlightTsslCompiles();
    void stopTsslCompileWorker();
    void stopTranspileWorker();
});

// The two ts-morph workers are stood up by the first open of a document that needs one, not here - see
// prewarmWorkerFor in handlers/document-lifecycle.ts. Starting both unconditionally cost every session
// ~214 MB resident and ~940 ms of setup for a feature only .tssl/.tbaf/.td authors reach.

// Attach the document manager and start the LSP transport.
documents.listen(connection);
connection.listen();
