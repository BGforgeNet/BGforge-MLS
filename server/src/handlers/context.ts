/**
 * Shared context threaded to every LSP handler registration function.
 *
 * Every handler module exports `register(ctx: HandlerContext): void` and uses
 * ctx instead of importing server-level singletons directly. The single source
 * of truth for connection, documents, timing, debouncers, and rename-affected
 * URI tracking lives on this object, created once in server.ts.
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
