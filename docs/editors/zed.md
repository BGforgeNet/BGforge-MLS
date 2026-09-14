# Zed

Setup guide for using BGforge MLS with Zed.

- [Prerequisites](#prerequisites)
- [Extension](#extension)
  - [extension.toml](#extensiontoml)
  - [Cargo.toml](#cargotoml)
  - [src/lib.rs](#srclibrs)
  - [Language definitions](#language-definitions)
  - [Tree-sitter grammars](#tree-sitter-grammars)
  - [Highlight queries](#highlight-queries)
  - [Install](#install)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

## Extension

Zed requires a [Zed extension](https://zed.dev/docs/extensions) to register custom language servers. Until a BGforge MLS extension is published, create a local extension.

Create a directory (e.g., `~/zed-extensions/bgforge-mls/`) with the following files:

### `extension.toml`

```toml
id = "bgforge-mls"
name = "BGforge MLS"
version = "0.0.1"
schema_version = 1

[language_servers.bgforge-mls]
name = "BGforge MLS"
languages = [
  "Fallout SSL", "WeiDU BAF", "WeiDU D", "WeiDU TP2", "WeiDU SLB", "Fallout Worldmap",
  "Fallout MSG", "WeiDU TRA", "Infinity 2DA", "Fallout scripts.lst", "WeiDU log",
]

[language_servers.bgforge-mls.language_ids]
"Fallout SSL" = "fallout-ssl"
"WeiDU BAF" = "weidu-baf"
"WeiDU D" = "weidu-d"
"WeiDU TP2" = "weidu-tp2"
"WeiDU SLB" = "weidu-slb"
"Fallout Worldmap" = "fallout-worldmap-txt"
"Fallout MSG" = "fallout-msg"
"WeiDU TRA" = "weidu-tra"
"Infinity 2DA" = "infinity-2da"
"Fallout scripts.lst" = "fallout-scripts-lst"
"WeiDU log" = "weidu-log"
```

`language_ids` is required: without it Zed sends the lowercased language name (`fallout ssl`) as the LSP language
ID, which the server does not recognize, so the file gets no server features.

Besides the scripting languages, the server answers for MSG and TRA (formatting, outline, folding, parse-error
diagnostics), 2DA (formatting, semantic tokens coloring each column), `scripts.lst` (formatting) and `weidu.log`
(go-to-definition from a mod entry to its `.tp2`). SLB is served as WeiDU BAF. So is Sword Coast Stratagems SSL
(language ID `weidu-ssl`), which shares the `.ssl` extension with Fallout SSL; to use it, define another language
for it the same way and associate it per project.

### `Cargo.toml`

```toml
[package]
name = "bgforge-mls"
version = "0.0.1"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
zed_extension_api = "0.5"
```

### `src/lib.rs`

```rust
use zed_extension_api as zed;

struct BgforgeMlsExtension;

impl zed::Extension for BgforgeMlsExtension {
    fn new() -> Self {
        BgforgeMlsExtension
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        _worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        Ok(zed::Command {
            command: "bgforge-mls-server".to_string(),
            args: vec!["--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(BgforgeMlsExtension);
```

### Language definitions

**`languages/fallout-ssl/config.toml`**:

```toml
name = "Fallout SSL"
grammar = "ssl"
path_suffixes = ["ssl"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
brackets = [
  { start = "(", end = ")", close = true, newline = false },
  { start = "[", end = "]", close = true, newline = false },
  { start = "{", end = "}", close = true, newline = true },
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
]
```

**`languages/weidu-baf/config.toml`**:

```toml
name = "WeiDU BAF"
grammar = "baf"
path_suffixes = ["baf"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
brackets = [
  { start = "(", end = ")", close = true, newline = false },
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
  { start = "~", end = "~", close = true, newline = false, not_in = ["string"] },
]
```

**`languages/weidu-d/config.toml`**:

```toml
name = "WeiDU D"
grammar = "weidu_d"
path_suffixes = ["d"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
brackets = [
  { start = "(", end = ")", close = true, newline = false },
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
  { start = "~", end = "~", close = true, newline = false, not_in = ["string"] },
]
```

**`languages/weidu-tp2/config.toml`**:

```toml
name = "WeiDU TP2"
grammar = "weidu_tp2"
path_suffixes = ["tp2", "tpa", "tph", "tpp"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
brackets = [
  { start = "(", end = ")", close = true, newline = false },
  { start = "[", end = "]", close = true, newline = false },
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
  { start = "~", end = "~", close = true, newline = false, not_in = ["string"] },
]
```

**`languages/weidu-slb/config.toml`**:

```toml
name = "WeiDU SLB"
path_suffixes = ["slb"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
```

**`languages/fallout-msg/config.toml`**:

```toml
name = "Fallout MSG"
grammar = "fallout_msg"
path_suffixes = ["msg"]
brackets = [
  { start = "{", end = "}", close = true, newline = false },
]
```

**`languages/weidu-tra/config.toml`**:

```toml
name = "WeiDU TRA"
grammar = "weidu_tra"
path_suffixes = ["tra"]
line_comments = ["//"]
block_comment = ["/*", "*/"]
brackets = [
  { start = "\"", end = "\"", close = true, newline = false, not_in = ["string"] },
  { start = "~", end = "~", close = true, newline = false, not_in = ["string"] },
]
```

**`languages/infinity-2da/config.toml`**:

```toml
name = "Infinity 2DA"
path_suffixes = ["2da"]
```

**`languages/fallout-worldmap/config.toml`**:

```toml
name = "Fallout Worldmap"
```

**`languages/fallout-scripts-lst/config.toml`**:

```toml
name = "Fallout scripts.lst"
```

**`languages/weidu-log/config.toml`**:

```toml
name = "WeiDU log"
```

SLB, 2DA, Fallout Worldmap, scripts.lst and WeiDU log have no tree-sitter grammar, so they get no highlighting here -
only the server features. The last three have no `path_suffixes`, to avoid matching every `.txt`, `.lst` and `.log`
file. Use Zed's `file_types` setting to associate them by file name:

```json
{
  "file_types": {
    "Fallout Worldmap": ["**/worldmap.txt"],
    "Fallout scripts.lst": ["**/scripts.lst"],
    "WeiDU log": ["**/weidu.log"]
  }
}
```

Fallout SSL headers use `.h`, which the definition above leaves out of `path_suffixes`: Zed's built-in C++ language
claims it too, and between two languages claiming one suffix Zed picks by the order it registered them in, which no
setting controls. Map `.h` with the `file_types` setting instead
([file associations](https://zed.dev/docs/configuring-languages#file-associations)), which wins over the C++ claim -
in your user settings for every project, or in a project's `.zed/settings.json` for that project only:

```json
{
  "file_types": {
    "Fallout SSL": ["h"]
  }
}
```

### Tree-sitter grammars

Zed builds grammars from a git repository at a revision, and the generated parsers are not committed to
this one -- they are produced at build time. Unlike the other editors, Zed accepts no prebuilt parser and
no plain directory, so the published bundle has to be turned into a local repository first:

```bash
mkdir -p ~/.local/share/bgforge-mls
curl -fsSL -o /tmp/bgforge-grammars.zip \
  https://github.com/BGforgeNet/BGforge-MLS/releases/latest/download/bgforge-mls-tree-sitter-grammars.zip
unzip -oq /tmp/bgforge-grammars.zip -d ~/.local/share/bgforge-mls
cd ~/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars
git init -q && git add -A && git commit -qm "bgforge-mls grammars"
git rev-parse HEAD    # the rev for extension.toml below
```

Then reference it with a `file://` URL, which Zed supports for local extension development, using the
commit printed above:

```toml
[grammars.ssl]
repository = "file:///home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars"
commit = "<the rev printed above>"
path = "fallout-ssl"
```

Repeat per grammar, changing `path` to `weidu-baf`, `weidu-d`, `weidu-tp2`, `fallout-msg`, `weidu-tra`.
Re-run the `git add`/`commit` after downloading a newer bundle and update the commit.

A commit of the BGforge MLS repository cannot stand in for the bundle: git does not track the generated
`grammars/<name>/src/parser.c`, so the repository has no parser for Zed to compile.

### Highlight queries

Copy the highlight queries into each language directory (`languages/<lang>/highlights.scm`), from the
bundle you extracted above so the queries match the parsers they were generated with. Take them from each
grammar's `queries/zed/` directory, not `queries/` - the latter uses Neovim capture names, several of which
Zed names differently or does not style:

```bash
BUNDLE="$HOME/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars"
EXT_DIR="$HOME/zed-extensions/bgforge-mls"

for lang in fallout-ssl weidu-baf weidu-d weidu-tp2 fallout-msg weidu-tra; do
  cp "$BUNDLE/$lang/queries/zed/highlights.scm" "$EXT_DIR/languages/$lang/highlights.scm"
done
```

### Install

Open Zed, go to `Extensions`, click `Install Dev Extension`, and point to the directory.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside
tsserver ([TypeScript Plugins](typescript-plugins.md) describes what they do). In Zed they load through `vtsls`, its
default TypeScript server, whose `vtsls.tsserver.globalPlugins` setting starts tsserver with them. Add to your user
settings, replacing `<mls-node-modules>` with the `node_modules` directory holding `@bgforge/mls-server`:

```json
{
  "file_types": {
    "TypeScript": ["tssl", "td"]
  },
  "lsp": {
    "vtsls": {
      "settings": {
        "vtsls": {
          "tsserver": {
            "globalPlugins": [
              {
                "name": "@bgforge/mls-server/out/tssl-plugin",
                "location": "<mls-node-modules>",
                "enableForWorkspaceTypeScriptVersions": true
              },
              {
                "name": "@bgforge/mls-server/out/td-plugin",
                "location": "<mls-node-modules>",
                "enableForWorkspaceTypeScriptVersions": true
              }
            ]
          }
        }
      }
    }
  }
}
```

`enableForWorkspaceTypeScriptVersions` keeps the plugins loaded when a project's own TypeScript is in use, which
`vtsls` otherwise skips global plugins for. `name` must be a package path as above: tsserver refuses a plugin named by
an absolute path. `pnpm ls -g --parseable` lists that package as `<mls-node-modules>/@bgforge/mls-server`.

## Settings

Zed passes LSP settings via the `lsp` section in user or project settings (`~/.config/zed/settings.json` or `.zed/settings.json`):

```json
{
  "lsp": {
    "bgforge-mls": {
      "settings": {
        "bgforge": {
          "validate": "saveAndType",
          "falloutSSL": {
            "compilePath": "",
            "compileOptions": "-q -p -l -O2 -d -s -n",
            "outputDirectory": "",
            "headersDirectory": ""
          },
          "weidu": {
            "path": "weidu",
            "gamePath": ""
          }
        }
      }
    }
  }
}
```

See [Settings Reference](../settings.md) for all available options.
