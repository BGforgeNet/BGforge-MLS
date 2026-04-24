# TD TypeScript Plugin

TypeScript Language Service Plugin for `.td` (TypeScript-to-D dialog transpiler) files. Runs inside tsserver, not the LSP server.

## What it does

- **Injects `td-runtime.d.ts`** into the project file list so TD API functions (`begin`, `say`, `reply`, `goTo`, etc.) are available without manual declarations.
- **Overrides compiler settings** to use ES2020 target and exclude DOM lib, preventing browser types from cluttering completions.
- **Filters completions** in `.td` files by blocking ES2020 lib names (`Array`, `Map`, `Promise`, etc.) while keeping keywords, members, and locals.
- **Filters TD names** out of non-`.td` file completions (e.g., `.tbaf` files in the same project).

## How it works

Overrides the `LanguageServiceHost` and intercepts `LanguageService` via a `Proxy`:

- `getScriptFileNames` — appends `td-runtime.d.ts` when the project contains `.td` files
- `getCompilationSettings` — sets `target: ES2020` and `lib: ["lib.es2020.d.ts"]` for `.td` projects
- `getCompletionsAtPosition` — applies blocklist filtering per file type

Uses the current `host.getScriptFileNames()` (not a stale pre-override reference) so files added by other plugins or tsserver are seen.

## Source files

| File           | Purpose                                              |
| -------------- | ---------------------------------------------------- |
| `src/index.ts` | Plugin entry point, host overrides, completion proxy |

## Build

Bundled by esbuild as a standalone CJS module. Two outputs:

- `node_modules/bgforge-td-plugin/index.js` — loaded by tsserver in VSCode
- `server/out/td-plugin.js` — bundled into `@bgforge/mls-server` for other editors

## Tests

```bash
cd plugins/td-plugin && pnpm exec vitest run
```
