/**
 * Public protocol surface shared between the VS Code client and LSP server.
 * These identifiers are the stable integration points for third-party clients.
 */

/** Standard LSP workspace/executeCommand identifiers exposed by the server. */
export const LSP_COMMAND_COMPILE = "bgforge.compile";
export const LSP_COMMAND_PARSE_DIALOG = "bgforge.parseDialog";

/**
 * Prefix for per-language workspace-symbol executeCommand IDs.
 * Full ID is `{prefix}{languageId}` — see {@link lspWorkspaceSymbolsCommand}.
 *
 * Standard LSP `workspace/symbol` returns aggregated symbols across all
 * providers; clients that want results scoped to the active document's
 * language send `workspace/executeCommand` with this command and a
 * `{ query }` argument, receiving the filtered `SymbolInformation[]` back.
 * The set of supported languages is enumerated in
 * {@link WORKSPACE_SYMBOL_SCOPED_LANGUAGES}.
 */
export const LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX = "bgforge.workspaceSymbols.";

/** Languages whose providers implement workspace-symbol search. */
export const WORKSPACE_SYMBOL_SCOPED_LANGUAGES = ["fallout-ssl", "weidu-d", "weidu-tp2"] as const;

export type WorkspaceSymbolScopedLanguage = (typeof WORKSPACE_SYMBOL_SCOPED_LANGUAGES)[number];

/** Full executeCommand ID for scoped workspace-symbol search in `languageId`. */
export function lspWorkspaceSymbolsCommand(languageId: WorkspaceSymbolScopedLanguage): string {
    return `${LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX}${languageId}`;
}

/** VS Code extension command identifiers. These are client-side wrappers, not LSP commands. */
export const VSCODE_COMMAND_COMPILE = "extension.bgforge.compile";
export const VSCODE_COMMAND_DIALOG_PREVIEW = "extension.bgforge.dialogPreview";
