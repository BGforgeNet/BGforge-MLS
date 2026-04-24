# Geany

Setup guide for using BGforge MLS with Geany (2.1+).

- [Prerequisites](#prerequisites)
- [File types and syntax highlighting](#file-types-and-syntax-highlighting)
- [Language server](#language-server)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

Requires Geany 2.1+ with the [LSP Client plugin](https://plugins.geany.org/lsp.html) enabled.

## File types and syntax highlighting

Download `bgforge-mls-geany-<version>.zip` from the [latest GitHub release](https://github.com/BGforgeNet/BGforge-MLS/releases) and extract the `.conf` files to:

- **Linux/macOS**: `~/.config/geany/filedefs/`
- **Windows**: `%APPDATA%\geany\filedefs\`

Restart Geany after installing. The definitions provide keyword, function, and constant highlighting plus comment and string coloring via the C lexer. The zip also includes a highlight-only definition (no LSP provider) for WeiDU TRA (`.tra`, C lexer for comments).

Note: `.h` files default to C++ in Geany. For Fallout header files, select the filetype manually via `Document > Set Filetype`.

Tilde-quoted strings (`~text~`), used in WeiDU languages, are not highlighted as strings because the C lexer does not recognize `~` as a string delimiter.

## Language server

Enable the LSP Client plugin in `Tools > Plugin Manager`. Then open `Tools > LSP Client > User Configuration` and add entries for each language.

Each language needs its own section. The section name must match the filetype name from the installed `.conf` files (the part between `filetypes.` and `.conf`). Use `lang_id_mappings` to map file patterns to the LSP `languageId` that the server expects:

```ini
[fallout-ssl]
cmd=bgforge-mls-server --stdio
lang_id_mappings=fallout-ssl;*.ssl;fallout-ssl;*.h

[weidu-baf]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-baf;*.baf

[weidu-d]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-d;*.d

[weidu-tp2]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-tp2;*.tp2;weidu-tp2;*.tpa;weidu-tp2;*.tph;weidu-tp2;*.tpp

[fallout-worldmap-txt]
cmd=bgforge-mls-server --stdio
lang_id_mappings=fallout-worldmap-txt;worldmap.txt
```

Note: If `bgforge-mls-server` is not on your system PATH, use the full path to the executable.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

The LSP Client plugin supports `initialization_options` for passing settings to the server. Add to each language section:

```ini
[fallout-ssl]
cmd=bgforge-mls-server --stdio
lang_id_mappings=fallout-ssl;*.ssl;fallout-ssl;*.h
initialization_options={"bgforge": {"validate": "saveAndType", "falloutSSL": {"compilePath": "", "compileOptions": "-q -p -l -O2 -d -s -n", "outputDirectory": "", "headersDirectory": ""}, "weidu": {"path": "weidu", "gamePath": ""}}}

[weidu-baf]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-baf;*.baf
initialization_options={"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}

[weidu-d]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-d;*.d
initialization_options={"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}

[weidu-tp2]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-tp2;*.tp2;weidu-tp2;*.tpa;weidu-tp2;*.tph;weidu-tp2;*.tpp
initialization_options={"bgforge": {"validate": "saveAndType", "weidu": {"path": "weidu", "gamePath": ""}}}
```

Alternatively, put the JSON in a file and reference it:

```ini
initialization_options_file=/path/to/bgforge-mls-settings.json
```

See [Settings Reference](../settings.md) for all available options.
