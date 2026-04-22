/**
 * ServerContext — session-scoped container for LSP server state constructed
 * during `onInitialize` and read by request handlers. Module-level mutable
 * `let` globals in server.ts were moved here to satisfy rules/coding.md
 * "avoid shared mutable module state and import-time side effects".
 *
 * The internal barrier promise (`contextReady`) ensures that handlers racing
 * the initialization window never see an error — they simply await until the
 * context is available and then return real results.
 */

import type { MLSsettings, ProjectSettings } from "./settings";
import type { Translation } from "./translation";

/** Client capability flags negotiated during LSP initialization. */
interface ClientCapabilityFlags {
    readonly configuration: boolean;
    readonly workspaceFolders: boolean;
    readonly fileWatching: boolean;
}

/** Session-scoped state container populated once by onInitialize. */
export interface ServerContext {
    readonly capabilities: ClientCapabilityFlags;
    readonly workspaceRoot: string | undefined;
    readonly projectSettings: ProjectSettings;
    settings: MLSsettings;
    readonly translation: Translation;
}

let ctx: ServerContext | undefined;

// Barrier promise: resolves with the context when initServerContext is called.
// Callers that arrive before init simply await this and receive the real value.
let resolveContextReady: (value: ServerContext) => void;
const contextReady = new Promise<ServerContext>((resolve) => {
    resolveContextReady = resolve;
});

/** Populate the context holder. Called once from onInitialize in server.ts. */
export function initServerContext(value: ServerContext): void {
    ctx = value;
    resolveContextReady(value);
}

/**
 * Get the session context. Returns a promise that resolves once
 * initServerContext has been called. Handlers that arrive before init
 * simply wait — they never throw or return partial results.
 */
export function getServerContext(): Promise<ServerContext> {
    return contextReady;
}

/**
 * Get the session context without waiting — returns undefined before
 * initServerContext completes. Use only for handlers that must bail out
 * immediately (e.g. onDidChangeConfiguration, which can fire before init).
 */
export function tryGetServerContext(): ServerContext | undefined {
    return ctx;
}

/** Update the live settings in the context. Called from onDidChangeConfiguration. */
export function updateServerSettings(s: MLSsettings): void {
    if (!ctx) {
        throw new Error("ServerContext not initialized. Call initServerContext first.");
    }
    ctx.settings = s;
}
