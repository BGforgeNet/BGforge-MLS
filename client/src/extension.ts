"use strict";

import * as path from "path";
import * as vscode from "vscode";
import { type ExtensionContext } from "vscode";
import {
    type LanguageClientOptions,
    type ServerOptions,
    LanguageClient,
    TransportKind,
} from "vscode-languageclient/node";
import { type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageserver-protocol";
import {
    LSP_COMMAND_COMPILE,
    VSCODE_COMMAND_COMPILE,
    VSCODE_COMMAND_DIALOG_PREVIEW,
    WORKSPACE_SYMBOL_SCOPED_LANGUAGES,
    type WorkspaceSymbolScopedLanguage,
    lspWorkspaceSymbolsCommand,
} from "../../shared/protocol";
import { registerBinaryEditor } from "./editors/binaryEditor";
import { registerDialogTree } from "./dialog-tree/dialogTree";
import { registerDDialogTree } from "./dialog-tree/dialogTree-d";
import { conlog, initOutputChannel } from "./logging";

// Initialized in activate(), undefined until then
let client: LanguageClient | undefined;
const cmd_compile = VSCODE_COMMAND_COMPILE;
const cmd_dialogPreview = VSCODE_COMMAND_DIALOG_PREVIEW;

function getWorkspaceSymbolScopeLanguageId(): WorkspaceSymbolScopedLanguage | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return undefined;
    }
    const langId = document.languageId;
    return (WORKSPACE_SYMBOL_SCOPED_LANGUAGES as readonly string[]).includes(langId)
        ? (langId as WorkspaceSymbolScopedLanguage)
        : undefined;
}

export async function activate(context: ExtensionContext) {
    const outputChannel = initOutputChannel(context);
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };
    const disposable = vscode.commands.registerCommand(cmd_compile, compile);
    context.subscriptions.push(disposable);

    // Register binary file editor
    context.subscriptions.push(registerBinaryEditor(context));

    // If the extension is launched in debug mode then the debug server options are used
    // Otherwise the run options are used
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: {
            module: serverModule,
            transport: TransportKind.ipc,
            options: debugOptions,
        },
    };

    // Options to control the language client.
    //
    // `outputChannel` is set to the same channel `conlog` writes to. Without
    // it, vscode-languageclient creates its own "BGforge MLS"-named channel
    // for LSP traffic, which appears as a duplicate entry in the Output
    // dropdown alongside the extension's manual channel.
    const clientOptions: LanguageClientOptions = {
        outputChannel,
        documentSelector: [
            { scheme: "file", language: "infinity-2da" },

            { scheme: "file", language: "fallout-msg" },
            { scheme: "file", language: "fallout-scripts-lst" },
            { scheme: "file", language: "fallout-ssl" },
            { scheme: "file", language: "fallout-worldmap-txt" },

            { scheme: "file", language: "weidu-tp2" },

            { scheme: "file", language: "weidu-baf" },

            { scheme: "file", language: "weidu-d" },

            { scheme: "file", language: "weidu-ssl" },
            { scheme: "file", language: "weidu-slb" },

            { scheme: "file", language: "weidu-tra" },

            { scheme: "file", language: "weidu-log" },

            { scheme: "file", pattern: "**/*.tbaf" },
            { scheme: "file", pattern: "**/*.tssl" },
            { scheme: "file", pattern: "**/*.td" },
        ],
        middleware: {
            provideWorkspaceSymbols: async (query, token, next) => {
                const languageId = getWorkspaceSymbolScopeLanguageId();
                if (!languageId || !client) {
                    return next(query, token);
                }
                const params: ExecuteCommandParams = {
                    command: lspWorkspaceSymbolsCommand(languageId),
                    arguments: [{ query }],
                };
                return await client.sendRequest(ExecuteCommandRequest.type, params, token);
            },
        },
    };

    // Create the language client and start the client.
    client = new LanguageClient("bgforge-mls", "BGforge MLS", serverOptions, clientOptions);

    // Start the client. This will also launch the server
    await client.start();
    conlog("BGforge MLS client started");

    const sslDialogPreview = registerDialogTree(context, client);
    const dDialogPreview = registerDDialogTree(context, client);
    context.subscriptions.push(
        vscode.commands.registerCommand(cmd_dialogPreview, async () => {
            const document = vscode.window.activeTextEditor?.document;
            if (!document) {
                return;
            }
            if (sslDialogPreview.matchesDocument(document)) {
                await sslDialogPreview.openPreview();
                return;
            }
            if (dDialogPreview.matchesDocument(document)) {
                await dDialogPreview.openPreview();
                return;
            }
            vscode.window.showWarningMessage("Open a Fallout SSL, TSSL, D, or TD file to preview dialog");
        }),
    );
}

export async function deactivate(): Promise<void> {
    if (client === undefined) {
        return;
    }
    return await client.stop();
}

async function compile(document = vscode.window.activeTextEditor?.document) {
    if (!document || client === undefined) {
        return;
    }
    const uri = document.uri;
    const params: ExecuteCommandParams = {
        command: LSP_COMMAND_COMPILE,
        arguments: [
            {
                uri: uri.toString(),
            },
        ],
    };
    await client.sendRequest(ExecuteCommandRequest.type, params);
}
