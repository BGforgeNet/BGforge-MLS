# LSP API

Public protocol surface for third-party LSP clients integrating with `@bgforge/mls-server`.

This document covers:

- standard LSP commands exposed via `workspace/executeCommand`
- custom requests and notifications used by the full VS Code client
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
- Transpiler files: transpiles `.tssl`, `.tbaf`, `.td`, then runs the relevant downstream compile/parse flow

Notes:

- The `uri` must use the `file` scheme.
- Diagnostics are reported through normal LSP `textDocument/publishDiagnostics`.
- Success/failure UI messages are client-dependent.

### `bgforge.parseDialog`

Parse dialog-tree data for preview UIs.

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

This command is intended for clients that implement a dialog preview UI.

## Custom Methods

These methods are not part of standard LSP. Third-party clients may ignore them unless they want feature parity with the VS Code extension.

### Notification: `bgforge-mls/load-finished`

Sent by the server after initialization and provider loading complete.

Use case:

- hide a client-side loading indicator once the server is ready

Payload:

- none

Optional:

- safe to ignore in generic clients

### Request: `bgforge-mls/setBuiltInCompiler`

Sent by the server to the client after an interactive Fallout SSL compile fails to launch the configured external compiler and the user chooses to switch to the built-in compiler.

Params:

```json
{
    "uri": "file:///path/to/script.ssl"
}
```

Expected client behavior:

- persist `bgforge.falloutSSL.compilePath = ""`
- prefer workspace-folder scope when the URI belongs to a workspace folder

Optional:

- safe to ignore if the client does not support settings persistence
- the server treats failure as non-fatal and still continues with the built-in compiler for that compile

## VS Code Extension Commands

These are VS Code extension-host commands, not LSP commands:

- `extension.bgforge.compile`
- `extension.bgforge.dialogPreview`

Third-party LSP clients should not rely on these identifiers. Use the standard LSP command ids above instead.

## Standard Method Extensions

The server uses standard LSP methods wherever possible. In one case, the VS Code client and server use a repo-specific convention layered onto a standard request.

### `workspace/symbol`

The server accepts ordinary standard LSP `workspace/symbol` requests:

```json
{
    "query": "foo"
}
```

With a plain query string, the server performs the default global aggregation across providers.

The VS Code client can also opt into language-scoped results by encoding the active language into the same `query` field:

```json
{
    "query": "bgforge-ws:weidu-d:foo"
}
```

Format:

- `bgforge-ws:<languageId>:<query>`

Supported `languageId` values:

- `fallout-ssl`
- `weidu-d`
- `weidu-tp2`

Behavior:

- scoped query: only the matching provider contributes workspace symbols
- plain query: all providers with `workspaceSymbols()` contribute results

Compatibility:

- third-party clients do not need to change anything to remain compatible
- clients that want language-scoped Ctrl+T behavior must opt in by using the encoded query format above
- this convention is repo-specific and not part of standard LSP

Rationale:

- standard LSP `workspace/symbol` provides only a free-form `query` string
- it does not carry current document URI or language id
- the encoding is therefore the only lightweight way for a client to request active-language scoping without defining a separate custom request
