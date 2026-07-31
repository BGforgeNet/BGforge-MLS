/**
 * Public protocol surface shared between the VS Code client and LSP server.
 * These identifiers are the stable integration points for third-party clients.
 */

/** Standard LSP workspace/executeCommand identifiers exposed by the server. */
export const LSP_COMMAND_COMPILE = "bgforge.compile";
export const LSP_COMMAND_PARSE_DIALOG = "bgforge.parseDialog";
/**
 * Persist edited translation strings to the resolved `.tra`/`.msg` for a dialog.
 * Argument: `{ uri: string, messages: Record<string, string> }`. The server
 * resolves the consumer's translation file and rewrites only the changed entries.
 */
export const LSP_COMMAND_SAVE_TRA = "bgforge.saveDialogTra";

/**
 * Prefix for per-language workspace-symbol executeCommand IDs.
 * Full ID is `{prefix}{languageId}` - see {@link lspWorkspaceSymbolsCommand}.
 *
 * Standard LSP `workspace/symbol` returns aggregated symbols across all
 * providers; clients that want results scoped to the active document's
 * language send `workspace/executeCommand` with this command and a
 * `{ query }` argument, receiving the filtered `SymbolInformation[]` back.
 * The set of supported languages is enumerated in
 * {@link WORKSPACE_SYMBOL_SCOPED_LANGUAGES}.
 */
export const LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX = "bgforge.workspaceSymbols.";

/**
 * The `window/logMessage` the server emits once the startup workspace scan has finished, after which
 * cross-file results (references, definition into another file) are complete.
 *
 * The scan is deliberately backgrounded, so a client that asks a cross-file question before this arrives gets a
 * partially-populated index and no indication of it. This is the signal to wait on - it is part of the shared
 * surface, not a log string, precisely so a consumer cannot be broken by a reworded message.
 */
export const LSP_LOG_WORKSPACE_SCAN_COMPLETE = "Workspace scan complete";

/** Languages whose providers implement workspace-symbol search. */
export const WORKSPACE_SYMBOL_SCOPED_LANGUAGES = ["fallout-ssl", "weidu-d", "weidu-tp2"] as const;

export type WorkspaceSymbolScopedLanguage = (typeof WORKSPACE_SYMBOL_SCOPED_LANGUAGES)[number];

/** Full executeCommand ID for scoped workspace-symbol search in `languageId`. */
export function lspWorkspaceSymbolsCommand(languageId: WorkspaceSymbolScopedLanguage): string {
    return `${LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX}${languageId}`;
}

/** VS Code extension command identifiers. These are client-side wrappers, not LSP commands. */
export const VSCODE_COMMAND_COMPILE = "extension.bgforge.compile";
