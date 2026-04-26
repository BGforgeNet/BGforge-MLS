/**
 * ServerContext — session-scoped container for LSP server state constructed
 * during `onInitialize` and read by request handlers. Module-level mutable
 * `let` globals in server.ts were moved here to satisfy rules/coding.md
 * "avoid shared mutable module state and import-time side effects".
 *
 * The internal barrier promise (`contextReady`) ensures that handlers racing
 * the initialization window never see an error — they simply await until the
 * context is available and then return real results.
 *
 * The barrier deliberately has no rejection path. Catastrophic init failure
 * (anything thrown from `onInitialize` before `initServerContext` is called)
 * surfaces via the LSP wire: the connection returns an error response to the
 * `initialize` request, and a conformant client stops dispatching subsequent
 * requests. Handlers therefore cannot legitimately observe a "never-resolved"
 * barrier in the field — only a server-side programming bug (an early return
 * between `registry.init()` and `initServerContext()` in handlers/initialize.ts)
 * could create that state, and any such bug would be caught by integration
 * tests on the first request the client sends.
 */

import { conlog, setDebugLogging } from "./common";
import type { MLSsettings, ProjectSettings } from "./settings";
import type { Translation } from "./translation";

/**
 * Threshold after which the init watchdog reports "ServerContext never
 * initialized". `onInitialize` calls `initServerContext` synchronously after
 * provider setup; in normal operation this is well under a second. 30 seconds
 * accommodates slow grammar/parser bring-up while still catching the silent-
 * hang failure mode (an early return between `registry.init()` and
 * `initServerContext()` in handlers/initialize.ts) before a user files a
 * "server unresponsive" report.
 */
const INIT_WATCHDOG_MS = 30_000;

/** Client capability flags negotiated during LSP initialization. */
interface ClientCapabilityFlags {
    readonly configuration: boolean;
    readonly workspaceFolders: boolean;
    readonly fileWatching: boolean;
}

/** Session-scoped state container populated once by onInitialize. */
interface ServerContext {
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

// Watchdog: emits a single warn-level log if initServerContext does not arrive
// within INIT_WATCHDOG_MS. Does NOT reject the barrier — the no-rejection
// invariant on contextReady is preserved (handlers can still resolve later if
// init eventually fires). This exists to surface the silent-hang failure mode
// in the operator-visible output channel rather than waiting for the user to
// notice unresponsive completions. .unref() lets the process exit cleanly if
// nothing else is keeping it alive (the LSP loop is the lifeline; the
// watchdog is observability only).
const initWatchdog = setTimeout(() => {
    conlog(
        `ServerContext was not initialized within ${INIT_WATCHDOG_MS} ms; ` +
            "request handlers awaiting the init barrier will hang. This indicates " +
            "an early return between provider init and initServerContext() in onInitialize.",
        "warn",
    );
}, INIT_WATCHDOG_MS);
initWatchdog.unref();

/** Populate the context holder. Called once from onInitialize in server.ts. */
export function initServerContext(value: ServerContext): void {
    clearTimeout(initWatchdog);
    ctx = value;
    setDebugLogging(value.settings.debug);
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
    setDebugLogging(s.debug);
}
