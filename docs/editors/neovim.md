# Neovim

Setup guide for using BGforge MLS with Neovim 0.11+.

- [Prerequisites](#prerequisites)
- [File type detection](#file-type-detection)
- [Language server](#language-server)
- [Tree-sitter highlighting](#tree-sitter-highlighting)
  - [Parser registration](#parser-registration)
  - [Manual query installation](#manual-query-installation)
- [File icons](#file-icons)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
pnpm install -g @bgforge/mls-server
```

## File type detection

```lua
vim.filetype.add({
  extension = {
    ssl = "fallout-ssl",
    h = "fallout-ssl",  -- or keep as "c" if you prefer; set per-project
    baf = "weidu-baf",
    d = "weidu-d",
    tp2 = "weidu-tp2",
    tpa = "weidu-tp2",
    tph = "weidu-tp2",
    tpp = "weidu-tp2",
  },
  filename = {
    ["worldmap.txt"] = "fallout-worldmap-txt",
  },
})

-- MSG and TRA are highlight-only (no LSP provider), so no filetype needed
-- for the language server. Register them if using tree-sitter highlighting:
vim.filetype.add({
  extension = {
    msg = "fallout-msg",
    tra = "weidu-tra",
  },
})
```

Note: `.h` files default to C in Neovim. The config above overrides this globally. For per-project control, use `.nvimrc` or `exrc` instead.

Note: `.d` files may conflict with D language. Adjust per-project if needed.

Worldmap.txt is an INI-like format. Borrow Neovim's built-in `dosini` syntax for highlighting:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = "fallout-worldmap-txt",
  callback = function()
    vim.bo.syntax = "dosini"
  end,
})
```

Set `commentstring` so that `gc`/`gcc` work correctly:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "fallout-ssl", "weidu-baf", "weidu-d", "weidu-tp2" },
  callback = function()
    vim.bo.commentstring = "// %s"
  end,
})
```

## Language server

```lua
vim.lsp.config["bgforge-mls"] = {
  cmd = { "bgforge-mls-server", "--stdio" },
  filetypes = { "fallout-ssl", "weidu-baf", "weidu-d", "weidu-tp2", "fallout-worldmap-txt" },
  root_markers = { ".git" },
}

vim.lsp.enable("bgforge-mls")
```

## Tree-sitter highlighting

### Parser registration

The generated parsers are not in the git repository (they are produced at build time), so a recipe
pointing `url` at it has nothing to compile. Two ways round that; the first needs no extra tooling.

**From the published bundle.** Download and extract it:

```bash
mkdir -p ~/.local/share/bgforge-mls
curl -fsSL -o /tmp/bgforge-grammars.zip \
  https://github.com/BGforgeNet/BGforge-MLS/releases/latest/download/bgforge-mls-tree-sitter-grammars.zip
unzip -oq /tmp/bgforge-grammars.zip -d ~/.local/share/bgforge-mls
```

For daily builds from the default branch, replace `latest/download` with `download/grammars-nightly`.
Then register each parser with `path` (a local directory) rather than `url`, pointing `queries` at the
bundled query files:

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    local parsers = require("nvim-treesitter.parsers")
    local bundle = vim.fn.expand("~/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars")

    for lang, grammar in pairs({
      ssl = "fallout-ssl",
      baf = "weidu-baf",
      weidu_d = "weidu-d",
      weidu_tp2 = "weidu-tp2",
      fallout_msg = "fallout-msg",
      weidu_tra = "weidu-tra",
    }) do
      parsers[lang] = {
        install_info = {
          path = bundle .. "/" .. grammar,
          queries = bundle .. "/" .. grammar .. "/queries",
        },
      }
    end
  end,
})
```

**From the repository, generating the parser locally.** Requires the
[tree-sitter CLI](https://github.com/tree-sitter/tree-sitter/blob/master/crates/cli/README.md) on
`PATH`; `generate = true` runs it, which is what makes a repository without a committed `src/parser.c`
usable. The `location` field points to the grammar subdirectory in the monorepo, and `queries` specifies
the highlight query files:

```lua
vim.api.nvim_create_autocmd("User", {
  pattern = "TSUpdate",
  callback = function()
    local parsers = require("nvim-treesitter.parsers")
    local url = "https://github.com/BGforgeNet/BGforge-MLS"

    parsers.ssl = {
      install_info = {
        url = url,
        location = "grammars/fallout-ssl",
        queries = "grammars/fallout-ssl/queries",
        generate = true,
      },
    }
    parsers.baf = {
      install_info = {
        url = url,
        location = "grammars/weidu-baf",
        queries = "grammars/weidu-baf/queries",
        generate = true,
      },
    }
    parsers.weidu_d = {
      install_info = {
        url = url,
        location = "grammars/weidu-d",
        queries = "grammars/weidu-d/queries",
        generate = true,
      },
    }
    parsers.weidu_tp2 = {
      install_info = {
        url = url,
        location = "grammars/weidu-tp2",
        queries = "grammars/weidu-tp2/queries",
        generate = true,
      },
    }
    parsers.fallout_msg = {
      install_info = {
        url = url,
        location = "grammars/fallout-msg",
        queries = "grammars/fallout-msg/queries",
        generate = true,
      },
    }
    parsers.weidu_tra = {
      install_info = {
        url = url,
        location = "grammars/weidu-tra",
        queries = "grammars/weidu-tra/queries",
        generate = true,
      },
    }
  end,
})
```

Map tree-sitter grammar names to Neovim filetypes:

```lua
vim.treesitter.language.register("ssl", "fallout-ssl")
vim.treesitter.language.register("baf", "weidu-baf")
vim.treesitter.language.register("weidu_d", "weidu-d")
vim.treesitter.language.register("weidu_tp2", "weidu-tp2")
vim.treesitter.language.register("fallout_msg", "fallout-msg")
vim.treesitter.language.register("weidu_tra", "weidu-tra")
```

Install the parsers:

```vim
:TSInstall ssl baf weidu_d weidu_tp2 fallout_msg weidu_tra
```

### Manual query installation

If highlights aren't installed automatically, copy them from the extracted bundle -- keeping queries and
parsers from the same build, rather than pulling queries from the default branch:

```bash
BUNDLE="$HOME/.local/share/bgforge-mls/bgforge-mls-tree-sitter-grammars"
NVIM_QUERIES="${XDG_CONFIG_HOME:-$HOME/.config}/nvim/queries"

for pair in "fallout-ssl:ssl" "weidu-baf:baf" "weidu-d:weidu_d" "weidu-tp2:weidu_tp2" "fallout-msg:fallout_msg" "weidu-tra:weidu_tra"; do
  grammar="${pair%%:*}"
  lang="${pair##*:}"
  mkdir -p "$NVIM_QUERIES/$lang"
  cp "$BUNDLE/$grammar/queries/highlights.scm" "$NVIM_QUERIES/$lang/highlights.scm"
done
```

## File icons

File-tree icons (`nvim-tree`, `neo-tree`, `mini.files`, ...) come from [nvim-web-devicons](https://github.com/nvim-tree/nvim-web-devicons), keyed by extension and filename. Register the BGforge formats with `override_by_extension` and `override_by_filename`:

```lua
require("nvim-web-devicons").setup({
  override_by_extension = {
    -- scripts (LSP-backed)
    ssl = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "FalloutSSL" },
    baf = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduBAF" },
    d   = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduD" },
    tp2 = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduTP2" },
    tpa = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduTP2" },
    tph = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduTP2" },
    tpp = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduTP2" },
    slb = { icon = vim.fn.nr2char(0xF1C9), color = "#519aba", name = "WeiduSLB" },
    -- text data
    msg = { icon = vim.fn.nr2char(0xF075), color = "#498ba7", name = "FalloutMSG" },
    tra = { icon = vim.fn.nr2char(0xF1AB), color = "#498ba7", name = "WeiduTRA" },
    ["2da"] = { icon = vim.fn.nr2char(0xF1C9), color = "#8dc149", name = "Infinity2DA" },
    -- binary records (edited in VS Code; this only sets the file-tree icon)
    pro = { icon = vim.fn.nr2char(0xF1B2), color = "#cc7833", name = "FalloutPRO" },
    map = { icon = vim.fn.nr2char(0xF278), color = "#cc7833", name = "FalloutMAP" },
    itm = { icon = vim.fn.nr2char(0xF1B2), color = "#a074c4", name = "InfinityITM" },
    spl = { icon = vim.fn.nr2char(0xF1B2), color = "#a074c4", name = "InfinitySPL" },
    eff = { icon = vim.fn.nr2char(0xF1B2), color = "#a074c4", name = "InfinityEFF" },
    cre = { icon = vim.fn.nr2char(0xF1B2), color = "#a074c4", name = "InfinityCRE" },
  },
  override_by_filename = {
    ["worldmap.txt"] = { icon = vim.fn.nr2char(0xF278), color = "#498ba7", name = "FalloutWorldmap" },
  },
})
```

Glyphs are written as Nerd Font codepoints (FontAwesome `file_code_o` `0xF1C9`, `comment` `0xF075`, `language` `0xF1AB`, `map_o` `0xF278`, `cube` `0xF1B2`) so the snippet stays plain-text; rendering needs a [Nerd Font](https://www.nerdfonts.com/). Pick other glyphs from the [cheat sheet](https://www.nerdfonts.com/cheat-sheet) - `.2da` reuses the script glyph here, so swap in a table glyph if your font ships one.

## TypeScript plugins (TSSL/TD)

If you write `.tssl` or `.td` transpiler files, the server package includes TypeScript plugins that run inside tsserver. See [TypeScript Plugins](typescript-plugins.md) for setup.

## Settings

Pass settings under the `bgforge` namespace in the `settings` table:

```lua
vim.lsp.config["bgforge-mls"] = {
  cmd = { "bgforge-mls-server", "--stdio" },
  filetypes = { "fallout-ssl", "weidu-baf", "weidu-d", "weidu-tp2", "fallout-worldmap-txt" },
  root_markers = { ".git" },
  settings = {
    bgforge = {
      validate = "saveAndType",
      falloutSSL = {
        compilePath = "",
        compileOptions = "-q -p -l -O2 -d -s -n",
        outputDirectory = "",
        headersDirectory = "",
      },
      weidu = {
        path = "weidu",
        gamePath = "",
      },
    },
  },
}

vim.lsp.enable("bgforge-mls")
```

See [Settings Reference](../settings.md) for all available options.
