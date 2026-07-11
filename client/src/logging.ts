import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";

type LogLevel = "debug" | "info" | "warn" | "error";

let outputChannel: vscode.LogOutputChannel | undefined;
let debugEnabled = false;

/** Create the extension's output channel and register it for disposal. */
export function initOutputChannel(context: ExtensionContext): vscode.LogOutputChannel {
    // vscode-languageclient 10.x requires a LogOutputChannel for `outputChannel`; the `{ log: true }`
    // overload (VS Code 1.74+, under our 1.91 engine floor) returns one. conlog still uses appendLine,
    // which a LogOutputChannel inherits, so extension-side output is unchanged.
    const channel = vscode.window.createOutputChannel("BGforge MLS", { log: true });
    context.subscriptions.push(channel);
    outputChannel = channel;
    return channel;
}

/**
 * Toggle debug-level logging. Wired in `extension.ts` to the `bgforge.debug`
 * configuration so a fresh activation and a config-change both end up with the
 * same flag set; mirrors the server-side `setDebugLogging` pattern.
 */
export function setDebugLogging(enabled: boolean): void {
    debugEnabled = enabled;
}

/**
 * Log a message to the BGforge MLS output channel (falls back to console
 * before activate).
 *
 * `debug`-level messages are dropped unless `setDebugLogging(true)` was called
 * (driven by the `bgforge.debug` setting). The `[client]` tag distinguishes
 * extension-host writes from LSP-surfaced server messages on the shared
 * output channel. The vscode-languageclient formats server-originated lines
 * as `[Info|Warn|Error - HH:MM:SS] body`, so any line starting with `[client]`
 * is from the extension and any line starting with a level-and-timestamp
 * prefix is from the server (or its client-side LSP wrapper).
 */
export function conlog(message: string, level: LogLevel = "info"): void {
    if (level === "debug" && !debugEnabled) return;
    const levelTag = level === "info" ? "" : ` [${level}]`;
    const formatted = `[client]${levelTag} ${message}`;
    if (outputChannel) {
        outputChannel.appendLine(formatted);
        return;
    }
    console.log(formatted);
}
