/**
 * Per-server-instance state threaded to every LSP handler registration function.
 *
 * Every handler module exports `register(ctx: HandlerContext): void` and receives
 * the server-instance state it needs (connection, documents, debouncers, the
 * rename-suppression instance, the connection-bound getDocumentSettings closure,
 * timing options) through ctx. This is the only state that must flow through the
 * context — module-level singletons (`registry`, `conlog`, `getServerContext`,
 * `normalizeUri`, static data loaders, etc.) are stateless or pre-created and
 * are imported directly by the handlers that use them.
 */

import type { Connection, TextDocuments } from "vscode-languageserver/node";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { makeTimingOptions } from "../shared/time-handler";
import type { UriDebouncer } from "../core/uri-debouncer";
import type { NormalizedUri } from "../core/normalized-uri";
import type { MLSsettings } from "../settings";
import type { RenameSuppression } from "./rename-suppression";

export interface HandlerContext {
    connection: Connection;
    documents: TextDocuments<TextDocument>;
    timingOpts: ReturnType<typeof makeTimingOptions>;
    fileReloadDebouncer: UriDebouncer<NormalizedUri>;
    compileDebouncer: UriDebouncer<NormalizedUri>;
    renameSuppression: RenameSuppression;
    getDocumentSettings: (resource: string) => Thenable<MLSsettings>;
}
