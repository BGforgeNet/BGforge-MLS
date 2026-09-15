# LSP API

Public protocol surface for third-party LSP clients integrating with `@bgforge/mls-server`.

This document covers:

- standard LSP commands exposed via `workspace/executeCommand`
- repo-specific behavior layered onto standard LSP methods

Everything here travels over standard LSP methods, so none of it depends on the bundled VS Code client.

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
- The server also accepts `extension.bgforge.compile` for the same action, but does not advertise it; send
  `bgforge.compile`.

### `bgforge.parseDialog`

Parse dialog data for the Dialog Editor (and other clients that render dialog trees).

- Params: first argument object must include `uri: string`
- Result: dialog tree JSON with a `messages` map populated from translation files when available, or `null`

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

Supported sources, matched on the document's `languageId`:

- Fallout SSL (`fallout-ssl`)
- WeiDU D (`weidu-d`)
- TD: `typescript` with a `.td` uri
- TSSL: `typescript` with a `.tssl` uri

The server parses its own synced copy of the document, so the result is `null` unless the client has opened the
document (`textDocument/didOpen`). It is also `null` for an unsupported language or a parse failure.

This command is intended for clients that implement a dialog editor or preview UI.

### `bgforge.saveDialogTra`

Persist edited translation strings for a dialog to its resolved translation file (`.tra` for WeiDU D and TD,
`.msg` for Fallout SSL and TSSL). Only the entries named in `messages` are rewritten; the rest of the file is
left as it was.

- Params: first argument object `{ uri: string, messages: Record<string, string> }`, keyed by entry number
- Result: `{ changed: boolean }`, or `null` when `uri` or `messages` is missing or the document is not open

```json
{
  "command": "bgforge.saveDialogTra",
  "arguments": [
    {
      "uri": "file:///path/to/dialog.d",
      "messages": { "12": "Greetings, traveller." }
    }
  ]
}
```

Only the active language's file is written. When the same file also exists under other language subdirectories
(a `tra/<language>/` layout), those now carry the previous text, and the server says so with a `window/showMessage`
warning naming the stale languages.

## Integration notes

The server uses standard LSP methods wherever possible. The subsections below cover the conventions it layers onto
them.

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

### Quick fixes (`textDocument/codeAction`)

The server advertises `codeActionProvider` with `codeActionKinds: ["quickfix"]` and answers
`textDocument/codeAction` from the diagnostics the client passes in `context.diagnostics`. No action is
computed from the document text, so a client that sends an empty `context.diagnostics` gets an empty result.

One fix is offered today, for the syntax diagnostics published under the `BGforge MLS (syntax)` source. A
diagnostic worded `missing '<token>'` comes from a tree-sitter MISSING node, which names the exact token the
grammar expected at a zero-width position; the action inserts that token at the diagnostic's start:

```jsonc
{
  "title": "Insert missing ')'",
  "kind": "quickfix",
  "isPreferred": true,
  "diagnostics": [/* the diagnostic passed in */],
  "edit": {
    "documentChanges": [{ "textDocument": { "uri": "...", "version": 3 }, "edits": [{ "range": {}, "newText": ")" }] }],
  },
}
```

The edit is delivered as `documentChanges` with the document version, so a client applying a fix computed
against text the user has since edited rejects it rather than inserting at a position that has moved.

Two diagnostic shapes deliberately get no action:

- `Syntax error near '<token>'` comes from a tree-sitter ERROR node, which carries no expected token, so no
  single edit follows from it.
- `missing '<name>'` where the name is a grammar rule rather than punctuation (`identifier`, `string`):
  inserting the rule name would be a guess at content only the author has.

Compiler diagnostics (source `BGforge MLS`) name a symbol rather than a token and get no action either. Nor do
translation diagnostics (source `BGforge MLS (translation)`), published at information severity for a translation
reference whose entry is missing from a translation file the server has loaded.

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

## VS Code extension commands

The bundled client registers its own extension-host commands (`contributes.commands` in the root `package.json`).
They are not LSP commands; third-party clients use the ids above.
