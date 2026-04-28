import * as vscode from "vscode";
import type { ExtensionContext } from "vscode";

type LogLevel = "info" | "warn" | "error";

let outputChannel: vscode.OutputChannel | undefined;

/** Create the extension's output channel and register it for disposal. */
export function initOutputChannel(context: ExtensionContext): vscode.OutputChannel {
    const channel = vscode.window.createOutputChannel("BGforge MLS");
    context.subscriptions.push(channel);
    outputChannel = channel;
    return channel;
}

/**
 * Log a message to the BGforge MLS output channel (falls back to console
 * before activate).
 *
 * The `[client]` tag distinguishes extension-host writes from LSP-surfaced
 * server messages on the shared output channel. The vscode-languageclient
 * formats server-originated lines as `[Info|Warn|Error - HH:MM:SS] body`,
 * so any line starting with `[client]` is from the extension and any line
 * starting with a level-and-timestamp prefix is from the server (or its
 * client-side LSP wrapper).
 */
export function conlog(message: string, level: LogLevel = "info"): void {
    const levelTag = level === "info" ? "" : ` [${level}]`;
    const formatted = `[client]${levelTag} ${message}`;
    if (outputChannel) {
        outputChannel.appendLine(formatted);
        return;
    }
    console.log(formatted);
}
