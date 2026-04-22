/**
 * ServerContext — session-scoped container for LSP server state constructed
 * after `onInitialized` and read by request handlers. Module-level mutable
 * `let` globals in server.ts were moved here to satisfy rules/coding.md
 * "avoid shared mutable module state and import-time side effects".
 */

import type { MLSsettings, ProjectSettings } from "./settings";
import type { Translation } from "./translation";

/** Client capability flags negotiated during LSP initialization. */
interface ClientCapabilityFlags {
    readonly configuration: boolean;
    readonly workspaceFolders: boolean;
    readonly fileWatching: boolean;
}

/** Session-scoped state container populated once by onInitialized. */
interface ServerContext {
    readonly capabilities: ClientCapabilityFlags;
    readonly workspaceRoot: string | undefined;
    readonly projectSettings: ProjectSettings;
    settings: MLSsettings;
    readonly translation: Translation;
}

let ctx: ServerContext | undefined;

/** Populate the context holder. Called once from onInitialized in server.ts. */
export function initServerContext(value: ServerContext): void {
    ctx = value;
}

/**
 * Get the session context. Throws if onInitialized has not yet completed.
 * Safe to call from any request handler guarded by the `initialized` barrier.
 */
export function getServerContext(): ServerContext {
    if (!ctx) {
        throw new Error("ServerContext not initialized. Call initServerContext first.");
    }
    return ctx;
}

/**
 * Get the session context without throwing — returns undefined before
 * onInitialized completes. Use for handlers that may fire before the server is ready.
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
