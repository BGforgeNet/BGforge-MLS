# Neovim

Setup guide for using BGforge MLS with Neovim 0.11+.

- [Prerequisites](#prerequisites)
- [File type detection](#file-type-detection)
- [Language server](#language-server)
- [Tree-sitter highlighting](#tree-sitter-highlighting)
    - [Parser registration](#parser-registration)
    - [Manual query installation](#manual-query-installation)
- [TypeScript plugins (TSSL/TD)](#typescript-plugins-tssltd)
- [Settings](#settings)

## Prerequisites

```bash
npm install -g @bgforge/mls-server
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

Using [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter), register the parsers via a `TSUpdate` autocmd. The `location` field points to the grammar subdirectory in the monorepo, and `queries` specifies the highlight query files:

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
      },
    }
    parsers.baf = {
      install_info = {
        url = url,
        location = "grammars/weidu-baf",
        queries = "grammars/weidu-baf/queries",
      },
    }
    parsers.weidu_d = {
      install_info = {
        url = url,
        location = "grammars/weidu-d",
        queries = "grammars/weidu-d/queries",
      },
    }
    parsers.weidu_tp2 = {
      install_info = {
        url = url,
        location = "grammars/weidu-tp2",
        queries = "grammars/weidu-tp2/queries",
      },
    }
    parsers.fallout_msg = {
      install_info = {
        url = url,
        location = "grammars/fallout-msg",
        queries = "grammars/fallout-msg/queries",
      },
    }
    parsers.weidu_tra = {
      install_info = {
        url = url,
        location = "grammars/weidu-tra",
        queries = "grammars/weidu-tra/queries",
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

If highlights aren't installed automatically, copy them manually:

```bash
REPO="https://raw.githubusercontent.com/BGforgeNet/BGforge-MLS/master"
NVIM_QUERIES="${XDG_CONFIG_HOME:-$HOME/.config}/nvim/queries"

for pair in "fallout-ssl:ssl" "weidu-baf:baf" "weidu-d:weidu_d" "weidu-tp2:weidu_tp2" "fallout-msg:fallout_msg" "weidu-tra:weidu_tra"; do
  grammar="${pair%%:*}"
  lang="${pair##*:}"
  mkdir -p "$NVIM_QUERIES/$lang"
  curl -fsSL "$REPO/grammars/$grammar/queries/highlights.scm" \
    -o "$NVIM_QUERIES/$lang/highlights.scm"
done
```

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
