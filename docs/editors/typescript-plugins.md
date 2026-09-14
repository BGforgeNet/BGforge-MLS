# TypeScript Plugins (TSSL/TD)

The server package includes TypeScript Language Service Plugins for `.tssl` and `.td` transpiler files, at
`out/tssl-plugin.js` and `out/td-plugin.js`. They run inside tsserver (not the LSP server) and provide diagnostic
filtering, runtime type injection, and completion filtering.

- [What they do](#what-they-do)
- [Loading them](#loading-them)

## What they do

- **tssl-plugin**: Suppresses false TS6133 ("declared but never read") warnings for Fallout engine procedure names.
  Adds engine procedure hover documentation.
- **td-plugin**: Injects TD runtime types (`begin`, `say`, `reply`, etc.) so `.td` files get type checking without
  manual declarations. Filters completions: hides ES2020 lib names in `.td` files, hides TD-specific names in non-`.td`
  files.

## Loading them

VS Code loads them automatically.

In other editors, the TypeScript language server starts tsserver with the plugins. This is set once in the editor
configuration, with nothing to add to your projects; the "TypeScript plugins (TSSL/TD)" section of each editor guide
has the configuration. It also makes `.tssl` and `.td` files open as TypeScript, which is what attaches the TypeScript
server to them. Every configuration uses the same two values:

- **name**: `@bgforge/mls-server/out/tssl-plugin` and `@bgforge/mls-server/out/td-plugin`. tsserver refuses a plugin
  named by an absolute or relative path, so the name is always this package path.
- **location**: the `node_modules` directory that contains `@bgforge/mls-server`. For a global install,
  `pnpm ls -g --parseable` lists the package as `<that directory>/@bgforge/mls-server`; `pnpm root -g` does not print
  it, because pnpm 11 and later install each global package in its own directory below that root.

Where a guide installs `typescript` beside the language server, it pins version 6: TypeScript 7 ships no tsserver.

A `tsconfig.json` `compilerOptions.plugins` entry does not reach these files: tsserver applies it to the files of that
configured project, and `.tssl` and `.td` files are not among them, since `.tssl` and `.td` are not TypeScript
extensions. tsserver opens them in a separate inferred project, which takes only the plugins the language server
passes.
