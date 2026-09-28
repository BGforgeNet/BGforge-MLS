import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";

type LogLevel = "debug" | "info" | "warn" | "error";

let outputChannel: vscode.LogOutputChannel | undefined;

/** Create the extension's output channel and register it for disposal. */
export function initOutputChannel(context: ExtensionContext): vscode.LogOutputChannel {
    // vscode-languageclient 10.x requires a LogOutputChannel for `outputChannel`; the `{ log: true }`
    // overload (VS Code 1.74+, under our 1.91 engine floor) returns one.
    const channel = vscode.window.createOutputChannel("BGforge MLS", { log: true });
    context.subscriptions.push(channel);
    outputChannel = channel;
    return channel;
}

/**
 * Log a message to the BGforge MLS output channel (falls back to console before activate).
 *
 * Written at its own level, so the channel's "Set Log Level" decides what shows - including debug lines,
 * which it hides by default. The `[client]` tag tells extension-host lines from the server's, which reach
 * the same channel through the language client.
 */
export function conlog(message: string, level: LogLevel = "info"): void {
    const line = `[client] ${message}`;
    if (outputChannel) {
        outputChannel[level](line);
        return;
    }
    console.log(level === "info" ? line : `[${level}] ${line}`);
}
