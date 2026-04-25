"use strict";

import * as path from "path";
import * as vscode from "vscode";
import { type ExtensionContext, ConfigurationTarget, workspace } from "vscode";
import {
    type LanguageClientOptions,
    type ServerOptions,
    LanguageClient,
    TransportKind,
} from "vscode-languageclient/node";
import { type ExecuteCommandParams, ExecuteCommandRequest } from "vscode-languageserver-protocol";
import {
    LSP_COMMAND_COMPILE,
    NOTIFICATION_LOAD_FINISHED,
    REQUEST_SET_BUILT_IN_COMPILER,
    VSCODE_COMMAND_COMPILE,
    VSCODE_COMMAND_DIALOG_PREVIEW,
    encodeWorkspaceSymbolQuery,
} from "../../shared/protocol";
import { registerBinaryEditor } from "./editors/binaryEditor";
import { registerDialogTree } from "./dialog-tree/dialogTree";
import { registerDDialogTree } from "./dialog-tree/dialogTree-d";
import { ServerInitializingIndicator } from "./indicator";
import { conlog, initOutputChannel } from "./logging";

// Initialized in activate(), undefined until then
let client: LanguageClient | undefined;
const loadingIndicator = new ServerInitializingIndicator(() => {
    conlog("loading start");
});
const cmd_compile = VSCODE_COMMAND_COMPILE;
const cmd_dialogPreview = VSCODE_COMMAND_DIALOG_PREVIEW;

function getWorkspaceSymbolScopeLanguageId(): string | undefined {
    const document = vscode.window.activeTextEditor?.document;
    if (!document) {
        return undefined;
    }

    if (
        document.languageId === "fallout-ssl" ||
        document.languageId === "weidu-d" ||
        document.languageId === "weidu-tp2"
    ) {
        return document.languageId;
    }

    return undefined;
}

export async function activate(context: ExtensionContext) {
    initOutputChannel(context);
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

    // Options to control the language client
    const clientOptions: LanguageClientOptions = {
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
            provideWorkspaceSymbols: (query, token, next) => {
                return next(encodeWorkspaceSymbolQuery(query, getWorkspaceSymbolScopeLanguageId()), token);
            },
        },
    };

    // Create the language client and start the client.
    client = new LanguageClient("bgforge-mls", "BGforge MLS", serverOptions, clientOptions);

    loadingIndicator.startedLoadingProject("");

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

    client.onRequest(REQUEST_SET_BUILT_IN_COMPILER, async (params: { uri?: string }) => {
        const resource = params.uri ? vscode.Uri.parse(params.uri) : undefined;
        const configuration = workspace.getConfiguration("bgforge", resource);
        const target =
            resource && workspace.getWorkspaceFolder(resource)
                ? ConfigurationTarget.WorkspaceFolder
                : ConfigurationTarget.Global;
        await configuration.update("falloutSSL.compilePath", "", target);
        return true;
    });

    client.onNotification(NOTIFICATION_LOAD_FINISHED, () => {
        loadingIndicator.finishedLoadingProject("");
    });
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
