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
    WORKSPACE_SYMBOL_SCOPED_LANGUAGES,
    type WorkspaceSymbolScopedLanguage,
    lspWorkspaceSymbolsCommand,
} from "../../shared/protocol";
import { registerBinaryEditor } from "./binary-editor/register";
import { registerDialogEditor } from "./dialog-editor/panel";
import { registerDlgDialogEditor } from "./dialog-editor/dlg-panel";
import { registerImageEditor } from "./image-editor/register";
import { routeCompile } from "./script-view/compile-command";
import { registerScriptViews } from "./script-view/register";
import { LSP_DOCUMENT_SELECTOR } from "./document-selector";
import { conlog, initOutputChannel, setDebugLogging } from "./logging";
import { registerIeResources } from "./ie-resources/register";

// Initialized in activate(), undefined until then
let client: LanguageClient | undefined;
const cmd_compile = VSCODE_COMMAND_COMPILE;

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
    // The server reads `bgforge.debug` via the LSP configuration push; the
    // client tracks the same flag locally so client-side `conlog(..., "debug")`
    // can stay quiet by default and light up on demand for diagnostics.
    setDebugLogging(vscode.workspace.getConfiguration("bgforge").get<boolean>("debug", false));
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("bgforge.debug")) {
                setDebugLogging(vscode.workspace.getConfiguration("bgforge").get<boolean>("debug", false));
            }
        }),
    );
    // The server is implemented in node
    const serverModule = context.asAbsolutePath(path.join("server", "out", "server.js"));
    // The debug options for the server
    // --inspect=6009: runs the server in Node's Inspector mode so VS Code can attach to the server for debugging
    const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };
    const disposable = vscode.commands.registerCommand(cmd_compile, compile);
    context.subscriptions.push(disposable);

    // Register the IE game resource viewer (sidebar tree + game-resource FS provider); manages its own
    // disposables. First, because it owns the game session the binary editor resolves strrefs through.
    const gameLookups = registerIeResources(context);

    // Register binary file and animation editors
    // oxlint-disable-next-line unicorn/prefer-single-call -- merging with the push above would reorder the intervening setup.
    context.subscriptions.push(
        registerBinaryEditor(context, gameLookups),
        registerImageEditor(context),
        registerScriptViews(context, gameLookups.bcsSymbols),
    );

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
        documentSelector: LSP_DOCUMENT_SELECTOR,
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

    context.subscriptions.push(
        registerDialogEditor(context, client),
        // Compiled dialogs get their own viewType: `.dlg` is binary, and `bgforge.dialogEditor` is a
        // CustomTextEditorProvider. Both feed the same webview, so the two are one editor to a reader.
        registerDlgDialogEditor(context, {
            strref: gameLookups.strref,
            pickStrref: gameLookups.pickStrref,
            inbound: gameLookups.inbound,
            inboundToDialog: gameLookups.inboundToDialog,
            resourceBytes: gameLookups.resourceBytes,
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
    const target = document;
    const activeClient = client;
    await routeCompile(target, async () => {
        const params: ExecuteCommandParams = {
            command: LSP_COMMAND_COMPILE,
            arguments: [
                {
                    uri: target.uri.toString(),
                },
            ],
        };
        await activeClient.sendRequest(ExecuteCommandRequest.type, params);
    });
}
