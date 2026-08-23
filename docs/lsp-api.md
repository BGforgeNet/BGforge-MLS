# LSP API

Public protocol surface for third-party LSP clients integrating with `@bgforge/mls-server`.

This document covers:

- standard LSP commands exposed via `workspace/executeCommand`
- repo-specific behavior layered onto standard LSP methods
- which methods are portable to non-VSCode clients

## Standard LSP Commands

These commands are advertised by the server in `executeCommandProvider.commands`.

### `bgforge.compile`

Compile or validate the current document, depending on language and settings.

- Params: first argument object must include `uri: string`
- Typical call:

```json
{
  "command": "bgforge.compile",
  "arguments": [
    {
      "uri": "file:///path/to/script.ssl"
    }
  ]
}
```

Behavior:

- Fallout SSL: compiles `.ssl` using external or built-in compiler
- WeiDU files: parse-checks `.tp2`, `.tpa`, `.tph`, `.tpp`, `.d`, `.baf`
- TSSL: compiles `.tssl` straight to `.int` bytecode, with no SSL text in between
- Transpiler files: transpiles `.tbaf`, `.td`, then runs the relevant downstream compile/parse flow

Notes:

- The `uri` must use the `file` scheme.
- Diagnostics are reported through normal LSP `textDocument/publishDiagnostics`.
- Success/failure UI messages are client-dependent.

### `bgforge.parseDialog`

Parse dialog data for the Dialog Editor (and other clients that render dialog trees).

- Params: first argument object must include `uri: string`
- Result: dialog tree JSON with a `messages` map populated from translation files when available

Typical call:

```json
{
  "command": "bgforge.parseDialog",
  "arguments": [
    {
      "uri": "file:///path/to/dialog.d"
    }
  ]
}
```

Supported sources:

- Fallout SSL
- WeiDU D
- TD (`.td`)
- TSSL (`.tssl`)

This command is intended for clients that implement a dialog editor or preview UI.

## VS Code Extension Commands

These are VS Code extension-host commands, not LSP commands:

- `extension.bgforge.compile`
- `extension.bgforge.dialogEditor`

Third-party LSP clients should not rely on these identifiers. Use the standard LSP command ids above instead.

## Standard Method Extensions

The server uses standard LSP methods wherever possible. In one case, the VS Code client and server use a repo-specific convention layered onto a standard request.

### Language-scoped workspace symbols

Standard LSP `workspace/symbol` requests return the server's default global aggregation - symbols from every provider that implements workspace-symbol search:

```json
{
  "query": "foo"
}
```

A client that wants results scoped to a single language sends a `workspace/executeCommand` request instead, using a per-language command id:

```json
{
  "command": "bgforge.workspaceSymbols.weidu-d",
  "arguments": [{ "query": "foo" }]
}
```

The server runs only that language's provider and returns the filtered `SymbolInformation[]`.

Format:

- command: `bgforge.workspaceSymbols.<languageId>` (the `LSP_COMMAND_WORKSPACE_SYMBOLS_PREFIX` constant plus the language id, in `shared/protocol.ts`)
- argument: a single `{ "query": string }` object

Supported `languageId` values (`WORKSPACE_SYMBOL_SCOPED_LANGUAGES` in `shared/protocol.ts`):

- `fallout-ssl`
- `weidu-d`
- `weidu-tp2`

Compatibility:

- third-party clients need no changes to keep using plain `workspace/symbol` for global aggregation
- clients that want language-scoped Ctrl+T behavior opt in by sending the executeCommand above
- these command ids are repo-specific, layered onto the standard `workspace/executeCommand` method

In the bundled VS Code client this is wired through a `provideWorkspaceSymbols` middleware (`client/src/extension.ts`): when the active document belongs to a scoped language, the middleware forwards the request to the matching `bgforge.workspaceSymbols.<languageId>` command; otherwise it falls through to the standard aggregated request.

Rationale:

- standard LSP `workspace/symbol` provides only a free-form `query` string, with no current document URI or language id
- a dedicated per-language executeCommand carries the scope explicitly instead of overloading the query string

### Knowing when cross-file results are complete

The startup workspace scan is deliberately backgrounded: awaiting it would gate the `initialize` handshake on a
full tree walk, which is seconds to minutes on a large mod. Requests are served throughout, so a cross-file
answer asked for too early - find references, go to definition into another file, workspace symbols - is drawn
from a partially populated index and is indistinguishable from a complete one.

When the scan finishes, the server emits a `window/logMessage` whose text contains
`Workspace scan complete` (the `LSP_LOG_WORKSPACE_SCAN_COMPLETE` constant in `shared/protocol.ts`). A client
that cares about cross-file completeness can wait for it before issuing such a request, or surface it as an
indexing indicator. It is emitted exactly once per session, on the failure path as well, so a client waiting on
it cannot hang because the scan threw.

Single-file requests (hover, completion, document symbols, signature help, formatting) do not depend on the
scan and need no such wait.
