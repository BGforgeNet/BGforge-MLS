# Notepad++

Setup guide for using BGforge MLS with Notepad++.

- [Prerequisites](#prerequisites)
- [File types and syntax highlighting](#file-types-and-syntax-highlighting)
- [Language server](#language-server)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

Install the [NppLspClient](https://github.com/Ekopalypse/NppLspClient) plugin:

1. Download the latest release from [GitHub](https://github.com/Ekopalypse/NppLspClient/releases) (x64 or ARM64)
2. Extract into `Notepad++\plugins\NppLspClient\`
3. Restart Notepad++

## File types and syntax highlighting

Download `bgforge-mls-notepadpp-udl-<version>.zip` from the [latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases) and import the UDL files:

1. Go to `Language > User Defined Language > Define your language...`
2. Click `Import...` and select a `.udl.xml` file (e.g., `fallout-ssl.udl.xml`)
3. Restart Notepad++
4. Repeat for each language

The UDL files provide file type detection (by extension) and basic highlighting (keywords, functions, constants, comments, strings, folding). The zip also includes highlight-only definitions (no LSP provider) for Fallout MSG (`.msg`), WeiDU TRA (`.tra`), Infinity 2DA (`.2da`), and Fallout scripts.lst (`scripts.lst`).

Note: `.h` files default to C in Notepad++. The `fallout-ssl` UDL overrides this globally. If you also work with C headers, edit the UDL and remove `h` from the `Ext.` field.

For `worldmap.txt` and `scripts.lst`, select the language manually via `Language > fallout-worldmap-txt` or `Language > fallout-scripts-lst` since UDLs match by extension only and these files have generic or no extensions.

## Language server

Open `Plugins > NppLspClient > Open configuration file` and add server entries. The section name in `[lspservers.<name>]` must match the UDL name (shown in the Notepad++ status bar).

```toml
[lspservers.fallout-ssl]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true

[lspservers.weidu-baf]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true

[lspservers.weidu-d]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true

[lspservers.weidu-tp2]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true

[lspservers.fallout-worldmap-txt]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true
```

Note: If `bgforge-mls-server` is not on your system PATH, use the full path to the executable, e.g., `executable = 'C:\Users\<you>\AppData\Roaming\npm\bgforge-mls-server.cmd'`.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

NppLspClient passes the `settings` parameter via `workspace/configuration`. Add it to each server entry:

```toml
[lspservers.fallout-ssl]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true
settings = '{"bgforge": {"validate": "saveAndType", "falloutSSL": {"compilePath": "", "compileOptions": "-q -p -l -O2 -d -s -n", "outputDirectory": "", "headersDirectory": ""}, "weidu": {"path": "weidu", "gamePath": ""}}}'

[lspservers.weidu-baf]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true
settings = '{"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}'

[lspservers.weidu-d]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true
settings = '{"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}'

[lspservers.weidu-tp2]
mode = "io"
executable = 'bgforge-mls-server'
args = '--stdio'
auto_start_server = true
settings = '{"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}'
```

See [Settings Reference](../settings.md) for all available options.
