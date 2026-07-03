# Settings

([How to change settings in VScode](https://code.visualstudio.com/docs/getstarted/settings))

All settings are under the `bgforge` namespace.

## General

| Setting                             | Default       | Description                                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bgforge.validate`                  | `saveAndType` | When validation runs: `manual` = only when invoked explicitly, `save` = on save, `type` = while editing, `saveAndType` = on both save and edit. `type`/`saveAndType` are disk-intensive and debounced at 300ms.                                                                                               |
| `bgforge.diagnostics`               | `true`        | Report tree-sitter parse errors as diagnostics, alongside compiler diagnostics, for languages with a parser (Fallout SSL/MSG, WeiDU BAF/D/TP2/TRA). In-memory and instant, so it runs independently of `bgforge.validate`; set to `false` to silence the syntax source without disabling compiler validation. |
| `bgforge.binaryEditor.autoDumpJson` | `false`       | Whether saving a file in the binary editor should also write a JSON snapshot next to it.                                                                                                                                                                                                                      |
| `bgforge.debug`                     | `false`       | Enable debug logging in the Output panel (BGforge MLS channel)                                                                                                                                                                                                                                                |

## Fallout SSL

| Setting                                | Default                 | Description                                                                                                            |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bgforge.falloutSSL.compilePath`       | `""`                    | Path to sslc compiler. Drop exe into system PATH and enter filename, or use full path. Empty = use built-in.           |
| `bgforge.falloutSSL.compileOptions`    | `-q -p -l -O2 -d -s -n` | Compiler flags                                                                                                         |
| `bgforge.falloutSSL.outputDirectory`   | `""`                    | Output directory for compiled scripts (default: next to source)                                                        |
| `bgforge.falloutSSL.headersDirectory`  | `""`                    | Additional headers directory (workspace is always scanned)                                                             |
| `bgforge.falloutSSL.compileOnValidate` | `true`                  | When enabled, validation on save/edit also writes the compiled `.int`. Disable to validate without overwriting output. |

## WeiDU

| Setting                  | Default | Description                                                       |
| ------------------------ | ------- | ----------------------------------------------------------------- |
| `bgforge.weidu.path`     | `weidu` | Path to WeiDU binary (or add to system PATH)                      |
| `bgforge.weidu.gamePath` | `""`    | Absolute path to IE game directory (needed for BAF/D diagnostics) |

## Translations (`@N` message text)

`@N` references in Fallout SSL/MSG and WeiDU D/TRA resolve to their text - shown in hover, inlay hints, and the
dialog editor - from a `.tra`/`.msg` file. When resolution fails, every `@N` renders as its raw ref (the dialog
editor shows a banner saying so). Resolution is configured per project in a `.bgforge.yml` at the workspace root,
plus an optional per-file directive:

| Key                     | Default | Description                                                                                                                  |
| ----------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `translation.directory` | `tra`   | Directory scanned for `.tra`/`.msg`, relative to the workspace root (a path resolving outside it is ignored with a warning). |
| `translation.auto_tra`  | `true`  | Match a source file to `<basename>.tra`/`.msg` within `directory` (e.g. `x#viconia.d` -> `x#viconia.tra`).                   |

For a per-language layout such as `tra/english/x#viconia.tra`, point `translation.directory` at the language
subdirectory: `auto_tra` matches by basename _within_ `directory`, so a bare `tra` never finds a file nested under
`tra/<language>/`, and every `@N` stays unresolved.

```yaml
# .bgforge.yml (workspace root)
translation:
  directory: tra/english
```

To override resolution for a single file, put a directive on its **first line** (it takes precedence over
`auto_tra`):

```
/** @tra myfile.tra */
```

The directive names a word-character file only (`[A-Za-z0-9_]`); for a name containing other characters (e.g. the
`#` in `x#viconia`), use `translation.directory` instead.

## How to Pass Settings

Depends on the editor. See the editor-specific pages for examples:

- [Sublime Text](editors/sublime-text.md#settings) - `settings` in LSP client config
- [Neovim](editors/neovim.md#settings) - `settings` table in `vim.lsp.config`
- [Emacs](editors/emacs.md#settings) - `eglot-workspace-configuration` or lsp-mode
- [JetBrains](editors/jetbrains.md#settings) - LSP4IJ Configuration tab
- [Helix](editors/helix.md#settings) - `config` table in `languages.toml`
- [Zed](editors/zed.md#settings) - `settings` in `lsp` config
- [Geany](editors/geany.md#settings) - `initialization_options` in LSP Client config
- [Kate](editors/kate.md#settings) - `settings` in LSP client config (Kate 25.08+)
- [Notepad++](editors/notepadpp.md#settings) - `settings` in NppLspClient config
