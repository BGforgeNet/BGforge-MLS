# Helix

Setup guide for using BGforge MLS with Helix.

- [Prerequisites](#prerequisites)
- [Language server and file types](#language-server-and-file-types)
- [Tree-sitter highlighting](#tree-sitter-highlighting)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

## Language server and file types

Add to `~/.config/helix/languages.toml`:

```toml
[language-server.bgforge-mls]
command = "bgforge-mls-server"
args = ["--stdio"]

[[language]]
name = "fallout-ssl"
scope = "source.fallout-ssl"
grammar = "ssl"
file-types = ["ssl", "h"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "(" = ")", "[" = "]", "{" = "}", "\"" = "\"" }
language-servers = ["bgforge-mls"]

[[language]]
name = "weidu-baf"
scope = "source.weidu-baf"
grammar = "baf"
file-types = ["baf"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "(" = ")", "\"" = "\"", "~" = "~" }
language-servers = ["bgforge-mls"]

[[language]]
name = "weidu-d"
scope = "source.weidu-d"
grammar = "weidu_d"
file-types = [{ glob = "*.d" }]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "(" = ")", "\"" = "\"", "~" = "~" }
language-servers = ["bgforge-mls"]

[[language]]
name = "weidu-tp2"
scope = "source.weidu-tp2"
grammar = "weidu_tp2"
file-types = ["tp2", "tpa", "tph", "tpp"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "(" = ")", "[" = "]", "\"" = "\"", "~" = "~" }
language-servers = ["bgforge-mls"]

[[language]]
name = "fallout-worldmap-txt"
scope = "source.fallout-worldmap-txt"
grammar = "ini"
file-types = [{ glob = "worldmap.txt" }]
language-servers = ["bgforge-mls"]

# Highlight-only languages (no LSP provider)
[[language]]
name = "fallout-msg"
scope = "source.fallout-msg"
grammar = "fallout_msg"
file-types = ["msg"]

[[language]]
name = "weidu-tra"
scope = "source.weidu-tra"
grammar = "weidu_tra"
file-types = ["tra"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "\"" = "\"", "~" = "~" }
```

Note: `.h` files default to C in Helix. The config above overrides this globally. Remove `"h"` from the list if you also work with C headers.

## Tree-sitter highlighting

### Grammar configuration

Add grammar entries to `~/.config/helix/languages.toml` and add `grammar` to each `[[language]]` block above to link them:

```toml
[[grammar]]
name = "ssl"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/fallout-ssl" }

[[grammar]]
name = "baf"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/weidu-baf" }

[[grammar]]
name = "weidu_d"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/weidu-d" }

[[grammar]]
name = "weidu_tp2"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/weidu-tp2" }

[[grammar]]
name = "fallout_msg"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/fallout-msg" }

[[grammar]]
name = "weidu_tra"
source = { git = "https://github.com/BGforgeNet/BGforge-MLS", rev = "master", subpath = "grammars/weidu-tra" }
```

Fetch and build:

```bash
hx --grammar fetch
hx --grammar build
```

Copy highlight queries to `~/.config/helix/runtime/queries/<grammar>/`:

```bash
REPO="https://raw.githubusercontent.com/BGforgeNet/BGforge-MLS/master"
HELIX_QUERIES="${XDG_CONFIG_HOME:-$HOME/.config}/helix/runtime/queries"

for pair in "fallout-ssl:ssl" "weidu-baf:baf" "weidu-d:weidu_d" "weidu-tp2:weidu_tp2" "fallout-msg:fallout_msg" "weidu-tra:weidu_tra"; do
  grammar="${pair%%:*}"
  lang="${pair##*:}"
  mkdir -p "$HELIX_QUERIES/$lang"
  curl -fsSL "$REPO/grammars/$grammar/queries/highlights.scm" \
    -o "$HELIX_QUERIES/$lang/highlights.scm"
done
```

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

Helix passes LSP settings via the `config` table in `languages.toml`:

```toml
[language-server.bgforge-mls]
command = "bgforge-mls-server"
args = ["--stdio"]

[language-server.bgforge-mls.config.bgforge]
validate = "saveAndType"

[language-server.bgforge-mls.config.bgforge.falloutSSL]
compilePath = ""
compileOptions = "-q -p -l -O2 -d -s -n"
outputDirectory = ""
headersDirectory = ""

[language-server.bgforge-mls.config.bgforge.weidu]
path = "weidu"
gamePath = ""
```

See [Settings Reference](../settings.md) for all available options.
