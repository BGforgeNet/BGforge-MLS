/**
 * LSP-aware logger that routes through the connection's console.
 *
 * Logs target the VSCode "BGforge MLS" output channel, read by humans. They are
 * not consumed programmatically (no metrics sink, no log-shipping integration),
 * so structured-field / JSON / per-request correlation-ID emission is not
 * pursued - it would add ceremony without a downstream consumer to benefit. The
 * slow-request wrapper in shared/time-handler.ts already encodes the latency
 * timing that an operator would care about, in a human-readable line.
 */

import { getConnection } from "./lsp-connection";

type LogLevel = "debug" | "info" | "warn" | "error";

let debugEnabled = false;

/** Toggle debug-level logging. Called from server-context when settings.debug changes. */
export function setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
}

/**
 * Log a message through the LSP connection's console at the given level, which the client's output channel
 * files it under - so its "Set Log Level" decides what shows. Not `console.log`: a message of that type
 * carries no level, and the client appends it unfiltered.
 *
 * Debug-level messages are also dropped at the source unless {@link setDebugLogging} was called with true,
 * since some of them cost real work to build.
 */
export function conlog(message: string, level: LogLevel = "info"): void {
    if (level === "debug" && !debugEnabled) return;
    getConnection().console[level](message);
}
