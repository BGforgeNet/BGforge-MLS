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
languages = ["Fallout SSL", "WeiDU BAF", "WeiDU D", "WeiDU TP2", "Fallout Worldmap"]
```

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
path_suffixes = ["ssl", "h"]
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

**`languages/fallout-msg/config.toml`** (highlight-only, no LSP provider):

```toml
name = "Fallout MSG"
grammar = "fallout_msg"
path_suffixes = ["msg"]
brackets = [
  { start = "{", end = "}", close = true, newline = false },
]
```

**`languages/weidu-tra/config.toml`** (highlight-only, no LSP provider):

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

**`languages/fallout-worldmap/config.toml`**:

```toml
name = "Fallout Worldmap"
```

Fallout Worldmap has no `path_suffixes` to avoid matching all `.txt` files. Use Zed's `file_types` setting to associate `worldmap.txt`:

```json
{
    "file_types": {
        "Fallout Worldmap": ["**/worldmap.txt"]
    }
}
```

### Tree-sitter grammars

Add grammar entries to `extension.toml`. Update the `commit` SHA to the latest from the [repository](https://github.com/BGforgeNet/BGforge-MLS):

```toml
[grammars.ssl]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/fallout-ssl"

[grammars.baf]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/weidu-baf"

[grammars.weidu_d]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/weidu-d"

[grammars.weidu_tp2]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/weidu-tp2"

[grammars.fallout_msg]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/fallout-msg"

[grammars.weidu_tra]
repository = "https://github.com/BGforgeNet/BGforge-MLS"
commit = "dbdde670606b1b5d103f848cb22bb62a2e639fd8"
path = "grammars/weidu-tra"
```

### Highlight queries

Copy the highlight queries into each language directory (`languages/<lang>/highlights.scm`):

```bash
REPO="https://raw.githubusercontent.com/BGforgeNet/BGforge-MLS/master"
EXT_DIR="$HOME/zed-extensions/bgforge-mls"

for lang in fallout-ssl weidu-baf weidu-d weidu-tp2 fallout-msg weidu-tra; do
  curl -fsSL "$REPO/grammars/$lang/queries/highlights.scm" \
    -o "$EXT_DIR/languages/$lang/highlights.scm"
done
```

### Install

Open Zed, go to `Extensions`, click `Install Dev Extension`, and point to the directory.

Note: `.h` files default to C in Zed. The config above overrides this globally. For per-project control, add `file_types` overrides in `.zed/settings.json`.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

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
