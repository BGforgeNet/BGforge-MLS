# TSSL TypeScript Plugin

TypeScript Language Service Plugin for `.tssl` (TypeScript-to-SSL transpiler) files. Runs inside tsserver, not the LSP server.

## What it does

- **Suppresses TS6133** ("declared but never read") for Fallout engine procedure names (`start`, `talk_p_proc`, `combat_p_proc`, etc.). These are entry points called by the game engine, not dead code.
- **Adds hover documentation** for engine procedures, sourced from YAML-generated `fallout-ssl-engine-proc-docs.json`.

## How it works

Intercepts tsserver via a `Proxy` on `LanguageService`:

- `getSemanticDiagnostics` — filters out TS6133 for names in `fallout-ssl-engine-procedures.json`
- `getQuickInfoAtPosition` — appends engine procedure docs from `fallout-ssl-engine-proc-docs.json`

Only active for `.tssl` files; passes through unchanged for other file types.

## Source files

| File                        | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `src/index.ts`              | Plugin entry point, Proxy setup            |
| `src/filter-diagnostics.ts` | TS6133 identifier extraction and filtering |
| `src/engine-proc-hover.ts`  | Engine procedure hover doc injection       |

## Build

Bundled by esbuild as a standalone CJS module. Two outputs:

- `node_modules/bgforge-tssl-plugin/index.js` — loaded by tsserver in VSCode
- `server/out/tssl-plugin.js` — bundled into `@bgforge/mls-server` for other editors

Build dependency: `fallout-ssl-engine-procedures.json` and `fallout-ssl-engine-proc-docs.json` must be generated from YAML before bundling (done by `generate-data.sh`).

## Tests

```bash
cd plugins/tssl-plugin && pnpm exec vitest run
```
