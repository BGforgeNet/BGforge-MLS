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

[[language]]
name = "weidu-slb"
scope = "source.weidu-slb"
file-types = ["slb"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
language-servers = ["bgforge-mls"]

[[language]]
name = "fallout-msg"
scope = "source.fallout-msg"
grammar = "fallout_msg"
file-types = ["msg"]
language-servers = ["bgforge-mls"]

[[language]]
name = "weidu-tra"
scope = "source.weidu-tra"
grammar = "weidu_tra"
file-types = ["tra"]
comment-tokens = ["//"]
block-comment-tokens = { start = "/*", end = "*/" }
auto-pairs = { "\"" = "\"", "~" = "~" }
language-servers = ["bgforge-mls"]

[[language]]
name = "infinity-2da"
scope = "source.infinity-2da"
file-types = ["2da"]
language-servers = ["bgforge-mls"]

[[language]]
name = "fallout-scripts-lst"
scope = "source.fallout-scripts-lst"
file-types = [{ glob = "scripts.lst" }]
language-servers = ["bgforge-mls"]

[[language]]
name = "weidu-log"
scope = "source.weidu-log"
file-types = [{ glob = "weidu.log" }]
language-servers = ["bgforge-mls"]
```

The `name` of each `[[language]]` is the language ID Helix sends to the server, which dispatches on it, so keep the
names as written. SLB, 2DA, `scripts.lst` and `weidu.log` have no tree-sitter grammar and get no highlighting here -
only the server features.

Besides the scripting languages, the server answers for MSG and TRA (formatting, outline, folding, parse-error
diagnostics), 2DA (formatting, semantic tokens coloring each column), `scripts.lst` (formatting) and `weidu.log`
(go-to-definition from a mod entry to its `.tp2`). SLB is served as WeiDU BAF. So is Sword Coast Stratagems SSL
(language `weidu-ssl`), which shares the `.ssl` extension with Fallout SSL - define it per project, in a
`.helix/languages.toml`, rather than globally.

Note: `.h` files default to C in Helix. The config above overrides this globally. Remove `"h"` from the list if you also work with C headers.

## Tree-sitter highlighting

### Grammar configuration

The generated parsers are not in the git repository -- they are produced at build time -- so
`hx --grammar build` has nothing to compile when it fetches from a git source. Download the published
bundle and point Helix at it locally:

```bash
mkdir -p ~/.local/share/bgforge-mls
curl -fsSL -o /tmp/bgforge-grammars.zip \
  https://github.com/BGforgeNet/BGforge-MLS/releases/latest/download/bgforge-mls-tree-sitter-grammars.zip
unzip -oq /tmp/bgforge-grammars.zip -d ~/.local/share/bgforge-mls
```

Add grammar entries to `~/.config/helix/languages.toml`; the `grammar` keys in the `[[language]]` blocks
above already name them. `source.path` takes an absolute path -- expand `~` yourself, Helix does not:

```toml
[[grammar]]
name = "ssl"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/fallout-ssl" }

[[grammar]]
name = "baf"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/weidu-baf" }

[[grammar]]
name = "weidu_d"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/weidu-d" }

[[grammar]]
name = "weidu_tp2"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/weidu-tp2" }

[[grammar]]
name = "fallout_msg"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/fallout-msg" }

[[grammar]]
name = "weidu_tra"
source = { path = "/home/you/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars/weidu-tra" }
```

Build them (`hx --grammar fetch` is only for git sources; a local path has nothing to fetch):

```bash
hx --grammar build
```

Copy highlight queries from the same bundle. Take them from each grammar's `queries/helix/` directory,
not `queries/` -- the latter uses Neovim capture names, several of which Helix names differently, and
numbers in particular would render as plain text. Note also that the destination directory is the
**language** name from `[[language]]` above (`fallout-ssl`), not the grammar name (`ssl`): Helix resolves
queries per language, and queries under a grammar name are silently never loaded, with
`hx --health <language>` then reporting its highlight queries as missing.

```bash
BUNDLE="$HOME/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars"
HELIX_QUERIES="${XDG_CONFIG_HOME:-$HOME/.config}/helix/runtime/queries"

for grammar in fallout-ssl weidu-baf weidu-d weidu-tp2 fallout-msg weidu-tra; do
  mkdir -p "$HELIX_QUERIES/$grammar"
  cp "$BUNDLE/$grammar/queries/helix/highlights.scm" "$HELIX_QUERIES/$grammar/highlights.scm"
done
```

Confirm both halves loaded before looking for color: `hx --health weidu-tp2` reports `Tree-sitter parser`
and `Highlight queries` separately, and both must be present.

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
