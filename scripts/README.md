# Scripts

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) | [docs/architecture.md](../docs/architecture.md)

## Main commands

| Command              | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `pnpm build`         | Default repo-wide build: client, server, webviews, TS plugin, CLIs            |
| `pnpm build:all`     | Full build: `pnpm build` plus tree-sitter grammars and editor bundles         |
| `pnpm test`          | Default repo-wide test suite from `test.sh` (excludes grammar and E2E suites) |
| `pnpm test:all`      | Full test suite: `pnpm test` plus grammar and external transpile suites       |
| `pnpm test:e2e`      | E2E tests (requires `pnpm build` first and host Electron libraries)           |
| `pnpm test:grammars` | Grammar tests (generate, lint, corpus, parse, format)                         |
| `pnpm package`       | Create VSIX package                                                           |

### Excluded from `pnpm build`

- **Grammars** (`pnpm build:grammar`) -- too slow for regular dev. Use `pnpm build:all` for the full build, or run `pnpm build:grammar` separately.
- **Editor bundles** (`pnpm build:editors`) -- included by `pnpm build:all`, not by `pnpm build`.

### Excluded from `pnpm test`

- **Grammars** (`pnpm test:grammars`) -- slow. Included by `pnpm test:all`, or run separately.
- **Transpile external** (`pnpm test:external`) -- included by `pnpm test:all`, not by `pnpm test`.
- **E2E** (`pnpm test:e2e`) -- requires a built extension, a VSCode instance, and host Electron libraries.

### Excluded from `server/pnpm test:unit`

- **Smoke test** (`test/smoke-stdio.test.ts`) -- requires a built server bundle (`pnpm build:base:server`). Run as part of `pnpm test` instead, which builds the bundle first.
- **Integration tests** (`test/integration/`) -- require external repos cloned via `pnpm test:external`. Run standalone with `cd server && pnpm test:integration`, or as part of `pnpm test` (which clones repos first).

## Temporary Artifacts

Store transient logs, generated scratch files, and test temp directories under the repo-level `tmp/` directory.

Avoid writing temporary data into source and fixture trees such as `server/test/`, `cli/test/`, `scripts/**`, or `grammars/**`.

## Running individual tests

```bash
# Server unit tests (vitest)
cd server && pnpm test:unit                              # All unit tests
cd server && pnpm exec vitest run test/td.test.ts        # Single file
cd server && pnpm exec vitest run --coverage             # With coverage

# Server integration tests (real fixtures from external repos)
cd server && pnpm test:integration                       # All integration tests

# TD/TBAF sample integration
bash server/test/td/test.sh                # Transpile .td samples, compare to expected .d
bash server/test/td/typecheck-samples.sh   # Type-check .td samples

# Single grammar
cd grammars/weidu-tp2 && pnpm test         # Test one grammar (any grammars/*/)

# CLI tests
pnpm test:cli                              # Exit codes and diff output
```

## Scripts in this directory

| Script                               | Description                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.sh`                            | Main test suite run by `pnpm test`. Typechecks client/server/CLI, runs Oxlint, server unit tests, client tests, TD/TBAF sample tests, formatting checks, CLI tests, external tests, integration tests, and knip — all in three parallel phases. Set `TEST_STOP_AFTER_BUILD=1` to exit after Phase 2 (used by `test-all.sh`). |
| `test-grammars.sh`                   | Run all grammar test suites (calls `test-grammar.sh` per grammar).                                                                                                                                                                                                                                                           |
| `test-grammar.sh`                    | Test a single grammar (generate, lint, corpus, highlight, parse, format, compare, idempotency).                                                                                                                                                                                                                              |
| `test-external.sh`                   | Clone external repos and run format/idempotency tests against them. Also provides fixtures for integration tests. Skips the pre-test repo reset when `EXTERNAL_REPOS_CLEAN=1` (set by `test.sh`).                                                                                                                            |
| `test-e2e.sh`                        | E2E test runner.                                                                                                                                                                                                                                                                                                             |
| `build-grammar.sh`                   | Build all tree-sitter grammars to WASM sequentially to avoid tree-sitter cache races, copy to server/out and format/out, generate SyntaxType enums in parallel.                                                                                                                                                              |
| `build-base-server.sh`               | esbuild bundle for the LSP server. Uses `--banner`/`--define` for import.meta.url patching.                                                                                                                                                                                                                                  |
| `build-base-client.sh`               | esbuild bundle for the client. Copies codicons font assets to `client/out/codicons/`.                                                                                                                                                                                                                                        |
| `build-base-webviews.sh`             | esbuild bundle for webview scripts (dialog tree, binary editor).                                                                                                                                                                                                                                                             |
| `build-dev.sh`                       | Minimal build for F5 development (skips CLIs, linting, tests).                                                                                                                                                                                                                                                               |
| `build-test.sh`                      | esbuild bundle for E2E test files.                                                                                                                                                                                                                                                                                           |
| `build-format-postbuild.sh`          | Post-build hook for `@bgforge/format`: copies tree-sitter WASM files to `format/out/` after tsup completes. Invoked by tsup's `onSuccess` hook.                                                                                                                                                                              |
| `build-bin-cli.sh`                   | esbuild bundle for the binary parser CLI.                                                                                                                                                                                                                                                                                    |
| `build-ts-plugin.sh`                 | esbuild bundle for TypeScript plugins. Usage: `build-ts-plugin.sh <plugin-name>` (e.g. tssl-plugin, td-plugin).                                                                                                                                                                                                              |
| `build-editors.sh`                   | Build editor-specific syntax bundles: TextMate (.tmbundle.zip), Kate KSH (.xml), Notepad++ UDL (.xml), Geany (.conf).                                                                                                                                                                                                        |
| `package.sh`                         | Create VSIX. Replaces pnpm symlinks with real copies for vsce, restores after via EXIT trap.                                                                                                                                                                                                                                 |
| `prepublish.sh`                      | Pre-publish hook run by vsce before packaging.                                                                                                                                                                                                                                                                               |
| `publish-format.sh`                  | Publish `@bgforge/format` (library + fgfmt bin) to npm.                                                                                                                                                                                                                                                                      |
| `publish-server.sh`                  | Publish `@bgforge/mls-server` to npm.                                                                                                                                                                                                                                                                                        |
| `publish-transpile.sh`               | Publish `@bgforge/transpile` (library + fgtp bin) to npm.                                                                                                                                                                                                                                                                    |
| `vitest.config.ts`                   | Vitest configuration for script-level tests.                                                                                                                                                                                                                                                                                 |
| `vitest.smoke.config.ts` _(server/)_ | Vitest configuration for the server smoke test (separate because it requires a built bundle).                                                                                                                                                                                                                                |
| `generate-data.sh`                   | Generate YAML data files from game engine sources.                                                                                                                                                                                                                                                                           |
| `regenerate-expected.sh`             | Regenerate tree-sitter grammar sources and types.                                                                                                                                                                                                                                                                            |
| `grammar-test-lib.sh`                | Shared helpers for grammar tests.                                                                                                                                                                                                                                                                                            |
| `esbuild-lib.sh`                     | Shared esbuild helpers (import.meta.url shim, WASM copy). Sourced by build scripts, not executed directly.                                                                                                                                                                                                                   |
| `preview-highlight.sh`               | Preview tree-sitter highlight output for a grammar's files. Usage: `preview-highlight.sh <grammar-name> [file]`.                                                                                                                                                                                                             |
| `syntaxes-to-json.sh`                | Convert TextMate grammars from YAML to JSON.                                                                                                                                                                                                                                                                                 |
| `lint-cli.sh`                        | Lint CLI source files.                                                                                                                                                                                                                                                                                                       |
| `lint-scripts.sh`                    | Lint script utility source files.                                                                                                                                                                                                                                                                                            |
| `lint-shell.sh`                      | Lint shell scripts (shellcheck).                                                                                                                                                                                                                                                                                             |
| `fallout-update.sh`                  | Update Fallout engine data.                                                                                                                                                                                                                                                                                                  |
| `ie-update.sh`                       | Update Infinity Engine data (BAF actions/triggers). Writes completion data to `server/data/weidu-baf-iesdp.yml`, then calls `generate-data.sh` to regenerate highlight stanzas.                                                                                                                                              |

## Data flow

See [docs/data-pipeline.md](../docs/data-pipeline.md) for the full diagram of how engine data moves from external sources to runtime JSON and TextMate grammars.

## Script utilities

- `scripts/utils/src/sort-yaml-stanzas-and-items.ts`
  Sorts YAML source files by top-level stanza name and, within each stanza, sorts `items:` entries by `name`.
  Also supports `--map-path`/`--sequence-key`/`--sort-key` to sort a named sequence within every entry of a map
  (e.g. sort `patterns` inside all `repository` stanzas of a TextMate grammar without reordering stanzas).
  It preserves comments and formatting by moving raw source slices instead of fully parsing and re-stringifying the file.
  Use this for manual data-file cleanup when you want deterministic ordering without YAML emitter churn.

- `scripts/utils/src/update-tp2-highlight.ts`
  Generates TextMate highlight patterns for 19 TP2 stanzas (actions, patches, flags, options, values, constants, callables, vars, etc.) from `server/data/weidu-tp2-base.yml`.
  Supports `skipCatchall` to omit items already matched by the `upper-case-constants` catch-all rule.
  Also exports shared helpers (`buildHighlightPatterns`, `updateHighlightStanza`) used by the BAF, D, and Fallout highlight scripts.
  Called by `generate-data.sh`. Analogous to `update-fallout-base-functions-highlight.ts` for Fallout.

- `scripts/utils/src/update-baf-highlight.ts`
  Generates TextMate highlight patterns for the `actions` and `triggers` stanzas in `syntaxes/weidu-baf.tmLanguage.yml`
  from `server/data/weidu-baf-iesdp.yml`. Called by `generate-data.sh`.

- `scripts/utils/src/update-d-highlight.ts`
  Generates TextMate highlight patterns for 8 D stanzas (actions, chain epilogue, keywords/sugar, state, trans features, trans next, transition, when) from `server/data/weidu-d-base.yml`.
  Called by `generate-data.sh`.
