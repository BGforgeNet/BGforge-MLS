# TypeScript Plugins (TSSL/TD)

The server package includes TypeScript Language Service Plugins for `.tssl` and `.td` transpiler files. These run inside tsserver (not the LSP server) and provide diagnostic filtering, runtime type injection, and completion filtering.

- [Setup](#setup)
- [What they do](#what-they-do)
- [Editor integration](#editor-integration)

## Setup

The plugins are bundled inside the server package at `out/tssl-plugin.js` and `out/td-plugin.js`. Find the install location:

```bash
MLS_DIR="$(pnpm root -g)/@bgforge/mls-server"
# or if installed locally:
MLS_DIR="$(pnpm root)/@bgforge/mls-server"
```

Add to your project's `tsconfig.json`:

```json
{
    "compilerOptions": {
        "plugins": [
            { "name": "/path/to/@bgforge/mls-server/out/tssl-plugin" },
            { "name": "/path/to/@bgforge/mls-server/out/td-plugin" }
        ]
    }
}
```

Replace `/path/to/@bgforge/mls-server` with the actual path from the shell command above. TypeScript's `plugins` array does not support shell variables - you must paste the resolved path.

## What they do

- **tssl-plugin**: Suppresses false TS6133 ("declared but never read") warnings for Fallout engine procedure names. Adds engine procedure hover documentation.
- **td-plugin**: Injects TD runtime types (`begin`, `say`, `reply`, etc.) so `.td` files get type checking without manual declarations. Filters completions: hides ES2020 lib names in `.td` files, hides TD-specific names in non-`.td` files.

## Editor integration

These plugins are loaded by tsserver, which runs independently of the LSP server. Any editor that uses tsserver for TypeScript support will pick them up from `tsconfig.json`:

- **VSCode**: Automatic (configured via the extension's `package.json`)
- **Neovim**: Works if using `typescript-language-server` or `ts_ls` for TypeScript
- **Emacs**: Works with `tide` or `lsp-mode` TypeScript support
- **Sublime Text**: Works with the `LSP-typescript` package
- **Helix**: Works with `typescript-language-server`
