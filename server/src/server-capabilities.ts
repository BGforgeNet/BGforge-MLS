import {
    type ServerCapabilities,
    TextDocumentSyncKind,
} from "vscode-languageserver/node";
import { semanticTokensLegend } from "./shared/semantic-tokens";
import {
    LSP_COMMAND_PARSE_DIALOG,
} from "../../shared/protocol";
import { COMMAND_compile } from "./compile";

export function getServerCapabilities(): ServerCapabilities {
    return {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        completionProvider: {
            resolveProvider: true,
            completionItem: { labelDetailsSupport: true },
            triggerCharacters: ["@"],
        },
        hoverProvider: true,
        signatureHelpProvider: {
            triggerCharacters: ["("],
        },
        semanticTokensProvider: {
            legend: semanticTokensLegend,
            full: true,
        },
        inlayHintProvider: true,
        definitionProvider: true,
        referencesProvider: true,
        renameProvider: { prepareProvider: true },
        documentFormattingProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        foldingRangeProvider: true,
        executeCommandProvider: {
            commands: [COMMAND_compile, LSP_COMMAND_PARSE_DIALOG],
        },
    };
}
