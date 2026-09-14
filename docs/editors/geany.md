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

Restart Geany after installing. The definitions provide keyword, function, and constant highlighting plus comment
and string coloring via the C lexer. The zip also includes definitions for WeiDU TRA (`.tra`, C lexer for comments)
and Fallout Worldmap (`worldmap.txt`).

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

[weidu-tra]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-tra;*.tra
```

For TRA the server provides formatting, outline, folding and parse-error diagnostics. It also serves MSG, 2DA,
`scripts.lst`, `weidu.log`, SLB and Sword Coast Stratagems SSL, but the zip defines no Geany filetypes for them, and
the LSP Client plugin configures servers per filetype.

Note: If `bgforge-mls-server` is not on your system PATH, use the full path to the executable.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside
tsserver ([TypeScript Plugins](typescript-plugins.md) describes what they do). In Geany they load through
`typescript-language-server`, which the LSP Client plugin's default configuration uses for TypeScript and which
passes plugins from its initialization options to tsserver.

1. Install it: `pnpm add -g typescript-language-server,typescript@6`
2. In `Tools > Configuration Files > filetype_extensions.conf`, add the extensions to the TypeScript line:
   `TypeScript=*.ts;*.cts;*.mts;*.tsx;*.tssl;*.td;`
3. In `Tools > LSP Client > User Configuration`, add to the `[TypeScript]` section, replacing `<mls-node-modules>`
   with the `node_modules` directory holding `@bgforge/mls-server`:

```ini
[TypeScript]
cmd=typescript-language-server --stdio
initialization_options={"plugins": [{"name": "@bgforge/mls-server/out/tssl-plugin", "location": "<mls-node-modules>"}, {"name": "@bgforge/mls-server/out/td-plugin", "location": "<mls-node-modules>"}]}
```

`name` must be a package path as above: tsserver refuses a plugin named by an absolute path.
`pnpm ls -g --parseable` lists that package as `<mls-node-modules>/@bgforge/mls-server`.

## Settings

The server does not read LSP initialization options; it requests its settings with `workspace/configuration`. The
LSP Client plugin answers that request from the JSON in `initialization_options`, looking up the requested `bgforge`
section in it, so settings placed there under a `bgforge` key reach the server. Add to each language section:

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

[weidu-tra]
cmd=bgforge-mls-server --stdio
lang_id_mappings=weidu-tra;*.tra
initialization_options={"bgforge": {"diagnostics": true}}
```

Alternatively, put the JSON in a file and reference it:

```ini
initialization_options_file=/path/to/bgforge-mls-settings.json
```

See [Settings Reference](../settings.md) for all available options.
