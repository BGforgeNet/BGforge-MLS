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

/** Log a message to the BGforge MLS output channel (falls back to console before activate). */
export function conlog(message: string, level: LogLevel = "info"): void {
    const prefix = level === "info" ? "" : `[${level}] `;
    if (outputChannel) {
        outputChannel.appendLine(`${prefix}${message}`);
        return;
    }
    console.log(`${prefix}${message}`);
}
