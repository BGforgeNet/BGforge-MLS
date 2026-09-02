# Scripts

See also: [docs/development.md](../docs/development.md) | [docs/architecture.md](../docs/architecture.md)

## Main commands

| Command              | Description                                                                   |
| -------------------- | ----------------------------------------------------------------------------- |
| `pnpm build`         | Default repo-wide build: client, server, webviews, TS plugin, CLIs            |
| `pnpm build:all`     | Full build: `pnpm build` plus tree-sitter grammars and editor bundles         |
| `pnpm test`          | Dev-loop suite from `test.sh`: every category, shallow - no coverage, sweeps  |
| `pnpm test:all`      | Close-out gate: adds coverage, the external-corpus sweep, the full SSL sweeps |
| `pnpm test:e2e`      | E2E tests (requires `pnpm build` first and host Electron libraries)           |
| `pnpm test:grammars` | Grammar tests (generate, lint, corpus, highlight, parse, format)              |
| `pnpm package`       | Create VSIX package                                                           |
| `pnpm dev:web`       | Run the extension in VS Code for the Web (code-server) for fast change review |

### Excluded from `pnpm build`

- **Grammars** (`pnpm build:grammar`) -- too slow for regular dev. Use `pnpm build:all` for the full build, or run `pnpm build:grammar` separately.
- **Editor bundles** (`pnpm build:editors`) -- included by `pnpm build:all`, not by `pnpm build`.

### Depth `pnpm test` runs at

`pnpm test` covers every category `pnpm test:all` does, at whatever depth fits a dev loop; what it leaves to
close-out is depth, not a category, so a broken category surfaces at edit time rather than at the gate.

- **Grammars** (`pnpm test:grammars`) -- run WHOLE by both. No shallower form exists that would be worth having.
- **Server integration** (`server/test/integration/`) -- run WHOLE by both. A subset was measured and rejected:
  the per-file test time is lopsided (one file is over half of it), but wall time is not, because the suite's
  15 files already run in parallel and its floor is whichever single file is slowest. Dropping the heaviest
  bought a few percent of the suite when that was measured. There is no cheap slice of this suite to take --
  shortening it means making an individual sweep cheaper, not running fewer of them.
- **SSL corpus** -- `pnpm test` runs the canary (`compilers/ssl/test/integration/corpus-smoke.test.ts`): the
  oracle pins plus a 24-script sample, seconds rather than minutes. It reports its own denominator, because a
  green sample must not read as a swept corpus. `pnpm test:all` runs the full compile/decompile/optimise sweeps.

### Runner settings that were measured and rejected

Recorded so they are not re-tried. Each was measured against the whole unit-suite set; the scheduler is not
the bottleneck here, total CPU work is, so changes that only reshuffle work paid nothing. Re-measure before
reviving one -- the figures behind these were taken on one machine and only the direction transfers.

- **One vitest process aggregating every project** (the root `vitest.config.ts` shape) instead of the eleven
  separate runs `test.sh` starts -- no better than the per-suite `--maxWorkers` caps, so the extra coupling
  buys nothing.
- **`pool: "threads"`** instead of the default `forks` -- slightly worse. Cheaper imports, dearer tests.
- **Pinning `--maxWorkers`** above or below the default -- worse in both directions. The default is already at
  the optimum; pinning it only makes the config wrong on a differently-sized machine.
- **`deps.optimizer.ssr`** on the server suite -- slightly worse.

What DID pay, for contrast: cutting the work itself (memoizing the spec-derived name/table lookups in
`binary/src`), and `isolate: false` on the two suites whose per-file import cost dominates their test time
(see `binary-editor/vitest.config.ts` for the constraint that puts on new tests there).

### Excluded from `pnpm test`

- **Coverage thresholds** -- coverage instrumentation roughly triples unit-test time; `pnpm test:all` enforces them.
  Deliberately close-out only: a threshold gate fails on ratchet drift, which is not the signal a dev loop wants.
- **External-corpus format sweep** (`test-external.sh`) -- multi-minute. It is read-only, so `pnpm test:all`
  runs it alongside the other suites reading the same trees.
- **Transpile external** (`pnpm test:transpile-external`) -- included by `pnpm test:all`, not by `pnpm test`.
- **E2E** (`pnpm test:e2e`) -- requires a built extension, a VSCode instance, and host Electron libraries.
- **Webview render harnesses** (`scripts/test-harness.sh`) -- need headless Chromium; the separate `Harness`
  CI workflow runs them, neither `pnpm test` nor `pnpm test:all` does.

### Excluded from `server/pnpm test:unit`

- **Smoke test** (`test/smoke-stdio.test.ts`) -- requires a built server bundle (`pnpm build:base:server`). Run as part of `pnpm test` instead, which builds the bundle first.
- **Integration tests** (`test/integration/`) -- require external repos cloned via `pnpm test:external`. Run standalone with `cd server && pnpm test:integration`, or as part of `pnpm test` / `pnpm test:all` (both clone repos first).

## VS Code in the browser (`pnpm dev:web`)

`pnpm dev:web` runs the extension in [code-server](https://github.com/coder/code-server) (VS Code in a browser) for fast
change review, with the repo loaded as an unpacked extension so iterating is just rebuild + reload the window. See
[dev-web.md](dev-web.md) for launching, the localhost secure-context requirement (the binary editor is a webview), and
configuration.

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

| Script                                | Description                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test.sh`                             | Dev-loop test suite run by `pnpm test`. Typechecks client/server/plugins/binary/format/transpilers, runs Oxlint, unit tests (no coverage), TD/TBAF sample tests, formatting checks, CLI tests, knip, the grammar suites, server integration, and the SSL corpus canary - all in parallel phases. `TEST_COVERAGE=1` switches the unit phase to coverage runs with thresholds; `TEST_STOP_AFTER_BUILD=1` exits after Phase 2 (both used by `test-all.sh`). |
| `test-scoped.sh`                      | Run only the test suites relevant to a set of changed paths (default: uncommitted git changes). Usage: `test-scoped.sh [--dry-run] [--full] [paths...]`; `--full` also runs `pnpm test:grammars` on a grammar/syntax change instead of just printing a notice.                                                                                                                                                                                           |
| `ensure-weidu.sh`                     | Print a WeiDU binary's path, downloading a pinned checksum-verified one into `.dev/` when the host has none. Called by `test.sh`, `test-all.sh` (which export it as `WEIDU_BIN`) and the CI build workflow, so the grammar differential runs everywhere instead of skipping itself.                                                                                                                                                                      |
| `test-grammars.sh`                    | Run all grammar test suites (calls `test-grammar.sh` per grammar).                                                                                                                                                                                                                                                                                                                                                                                       |
| `test-grammar.sh`                     | Test a single grammar (generate, lint, corpus, highlight, parse, format, compare, idempotency).                                                                                                                                                                                                                                                                                                                                                          |
| `test-external.sh`                    | Clone external repos and run format/idempotency tests against them. Also provides fixtures for integration tests. Read-only: the formatter runs in `--check-idempotency` mode and exclusions are passed as `--exclude-from`, so it runs beside the other corpus suites.                                                                                                                                                                                  |
| `test-e2e.sh`                         | E2E test runner.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `build-grammar.sh`                    | Build all tree-sitter grammars to WASM sequentially to avoid tree-sitter cache races, copy to server/out and format/out, generate SyntaxType enums in parallel.                                                                                                                                                                                                                                                                                          |
| `build-base-server.sh`                | esbuild bundle for the LSP server. Uses `--banner`/`--define` for import.meta.url patching.                                                                                                                                                                                                                                                                                                                                                              |
| `build-base-client.sh`                | esbuild bundle for the client. Copies codicons font assets to `client/out/codicons/`.                                                                                                                                                                                                                                                                                                                                                                    |
| `build-base-webviews.sh`              | esbuild bundle for webview scripts (dialog tree, binary editor).                                                                                                                                                                                                                                                                                                                                                                                         |
| `build-dev.sh`                        | Minimal build for F5 development (skips CLIs, linting, tests).                                                                                                                                                                                                                                                                                                                                                                                           |
| `build-test.sh`                       | esbuild bundle for E2E test files.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `build-format-postbuild.sh`           | Post-build hook for `@bgforge/format`: copies tree-sitter WASM files to `format/out/` after tsdown completes. Invoked by tsdown's `onSuccess` hook.                                                                                                                                                                                                                                                                                                      |
| `build-ts-plugin.sh`                  | esbuild bundle for TypeScript plugins. Usage: `build-ts-plugin.sh <plugin-name>` (e.g. tssl-plugin, td-plugin).                                                                                                                                                                                                                                                                                                                                          |
| `build-editors.sh`                    | Build editor-specific syntax bundles: TextMate (.tmbundle.zip), Kate KSH (.xml), Notepad++ UDL (.xml), Geany (.conf).                                                                                                                                                                                                                                                                                                                                    |
| `build-pidtypes.sh`                   | Generate the Fallout pid -> subType table from extracted `.pro` files. Usage: `build-pidtypes.sh <proto-dir> <output.json>`. Requires `jq` and a prior `pnpm build` (uses `binary/out/cli.js`).                                                                                                                                                                                                                                                          |
| `package-grammars.sh`                 | Bundle the generated tree-sitter parsers, queries and WASM builds into `dist/bgforge-mls-tree-sitter-grammars.zip`, one directory per grammar. The generated `src/` is gitignored, so this is what external editors install from. Needs a prior `pnpm build:grammar`.                                                                                                                                                                                    |
| `verify-grammar-bundle.sh`            | Gate for that bundle: extract it and build every grammar with `cc` the way a consuming editor does, then check the `tree_sitter_<language>` entrypoint is exported. Runs on every push; nothing else opens the archive. Usage: `verify-grammar-bundle.sh [zip]`.                                                                                                                                                                                         |
| `package.sh`                          | Create VSIX. Replaces pnpm symlinks with real copies for vsce, restores after via EXIT trap.                                                                                                                                                                                                                                                                                                                                                             |
| `prepublish.sh`                       | Pre-publish hook run by vsce before packaging.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `publish-binary.sh`                   | Publish `@bgforge/binary` (library + fgbin bin) to npm.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `publish-format.sh`                   | Publish `@bgforge/format` (library + fgfmt bin) to npm.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `publish-server.sh`                   | Publish `@bgforge/mls-server` to npm.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `publish-transpile.sh`                | Publish `@bgforge/transpile` (library + fgtp bin) to npm.                                                                                                                                                                                                                                                                                                                                                                                                |
| `publish-tssl.sh`                     | Publish `@bgforge/tssl` (compiler library + tssl bin) to npm.                                                                                                                                                                                                                                                                                                                                                                                            |
| `vitest.config.ts`                    | Vitest configuration for script-level tests.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `vitest.cli.config.ts`                | Vitest configuration that re-includes the `*-cli.test.ts` files excluded by each package's unit-test config, so they run as a single phase after the CLI bundles are built. Invoked by `pnpm test:cli`.                                                                                                                                                                                                                                                  |
| `vitest.smoke.config.mts` _(server/)_ | Vitest configuration for the server smoke test (separate because it requires a built bundle).                                                                                                                                                                                                                                                                                                                                                            |
| `generate-data.sh`                    | Generate YAML data files from game engine sources.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `regenerate-expected.sh`              | Regenerate tree-sitter grammar sources and types.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `grammar-generate-lib.sh`             | Cached `tree-sitter generate` and `tree-sitter build --wasm` wrappers (skip regeneration and recompilation when grammar inputs are unchanged). Sourced, not executed.                                                                                                                                                                                                                                                                                    |
| `grammar-test-lib.sh`                 | Shared helpers for grammar tests.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `esbuild-lib.sh`                      | Shared esbuild helpers (import.meta.url shim, WASM copy). Sourced by build scripts, not executed directly.                                                                                                                                                                                                                                                                                                                                               |
| `preview-highlight.sh`                | Preview tree-sitter highlight output for a grammar's files. Usage: `preview-highlight.sh <grammar-name> [file]`.                                                                                                                                                                                                                                                                                                                                         |
| `syntaxes-to-json.sh`                 | Convert TextMate grammars from YAML to JSON.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lint-scripts.sh`                     | Lint script utility source files.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `lint-shell.sh`                       | Lint shell scripts (shellcheck).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `fallout-update.sh`                   | Update Fallout engine data.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `ie-update.sh`                        | Update Infinity Engine data (BAF actions/triggers). Writes completion data to `server/data/weidu-baf-iesdp.yml`, then calls `generate-data.sh` to regenerate highlight stanzas.                                                                                                                                                                                                                                                                          |
| `ie-binary-update.sh`                 | Regenerate IE binary wire specs from IESDP `_data/file_formats/`. Writes generated `.ts` to `binary/src/{itm,spl,eff,ie-common}/specs/`. Clones IESDP on `ielib` branch into `external/infinity-engine/iesdp/` if missing.                                                                                                                                                                                                                               |
| `test-all.sh`                         | Full test suite run by `pnpm test:all`: main suite phases 1-2 with coverage, then grammar tests and the remaining suites (smoke, samples, external, integration, the full SSL corpus sweeps, transpile-external) in one parallel block. What it adds over `test.sh` is depth, not categories.                                                                                                                                                            |
| `test-harness.sh`                     | Playwright render/drive harnesses for the binary-editor and dialog-editor webviews, run as regression checks (the CI `Harness` job).                                                                                                                                                                                                                                                                                                                     |
| `test-transpile-external.sh`          | E2E transpiler check: transpile `.td`/`.tbaf`/`.tssl` from external repos and verify the committed outputs are unchanged.                                                                                                                                                                                                                                                                                                                                |
| `reset-external.sh`                   | Reset external repos to their committed state (clones them first if missing).                                                                                                                                                                                                                                                                                                                                                                            |
| `dev-web.sh`                          | Launch the extension in VS Code for the Web (code-server) for fast change review. See [dev-web.md](dev-web.md).                                                                                                                                                                                                                                                                                                                                          |
| `lint-workflows.sh`                   | Lint GitHub Actions workflow and composite-action YAML (actionlint + zizmor).                                                                                                                                                                                                                                                                                                                                                                            |
| `verify-package-contents.sh`          | Inspect the packaged VSIX and fail loud on unexpected entries, source/test files, or size regressions - the fail-closed backstop for the `.vscodeignore` denylist.                                                                                                                                                                                                                                                                                       |
| `verify-supply-chain.sh`              | Verify the supply-chain hardening artifacts (Scorecard/CodeQL workflows, SBOM and SLSA provenance steps) are present. First CI step.                                                                                                                                                                                                                                                                                                                     |
| `build-webviews.mjs`                  | esbuild bundler for the Svelte webviews. Invoked by `build-base-webviews.sh`.                                                                                                                                                                                                                                                                                                                                                                            |
| `esbuild-web-tree-sitter.mjs`         | Shared esbuild pieces (asset loaders + Node-import shims) for bundling web-tree-sitter into browser IIFE bundles. Used by `build-webviews.mjs` and the dialog render harness build.                                                                                                                                                                                                                                                                      |
| `split-syntax-type.mjs`               | Split dts-tree-sitter output into the runtime `syntax-type.ts` enum and `tree-sitter.d.ts` declarations (grammar `generate:types` pipeline).                                                                                                                                                                                                                                                                                                             |
| `external-repos-lib.sh`               | Shared lib for cloning/pinning the external fixture repos. Sourced, not executed.                                                                                                                                                                                                                                                                                                                                                                        |
| `parallel-lib.sh`                     | Parallel job runner for test scripts. Sourced, not executed.                                                                                                                                                                                                                                                                                                                                                                                             |
| `publish-lib.sh`                      | Shared publish tail for the `@bgforge` library packages. Sourced by `publish-*.sh`.                                                                                                                                                                                                                                                                                                                                                                      |
| `timing-lib.sh`                       | `step()` timing helpers for test scripts. Sourced, not executed.                                                                                                                                                                                                                                                                                                                                                                                         |
| `tool-download-lib.sh`                | Checksum-verified download of the pinned lint tools. Sourced by `lint-workflows.sh` / `lint-shell.sh`.                                                                                                                                                                                                                                                                                                                                                   |

## Data flow

See [docs/data-pipeline.md](../docs/data-pipeline.md) for the full diagram of how engine data moves from external sources to runtime JSON and TextMate grammars.

## Script utilities

- `scripts/utils/src/sort-yaml-stanzas-and-items.ts`
  Sorts YAML source files by top-level stanza name and, within each stanza, sorts `items:` entries by `name`.
  Also supports `--map-path`/`--sequence-key`/`--sort-key` to sort a named sequence within every entry of a map
  (e.g. sort `patterns` inside all `repository` stanzas of a TextMate grammar without reordering stanzas).
  It preserves comments and formatting by moving raw source slices instead of fully parsing and re-stringifying the file.
  Use this for manual data-file cleanup when you want deterministic ordering without YAML emitter churn.

- `scripts/utils/src/update-fallout-base-functions-highlight.ts`
  Generates TextMate highlight patterns for the `fallout-base-functions` stanza in `syntaxes/fallout-ssl.tmLanguage.yml`
  from active function stanzas in `server/data/fallout-ssl-base.yml`. Called by `generate-data.sh`.

- `scripts/utils/src/update-sfall-highlight.ts`
  Generates TextMate highlight patterns for the `sfall_functions` and `hooks` stanzas in `syntaxes/fallout-ssl.tmLanguage.yml`
  from `server/data/fallout-ssl-sfall.yml`. Called by `generate-data.sh`.

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

- `scripts/utils/src/generate-data.ts`
  Generates the LSP completion/hover/signature JSON files under `server/out/` from `server/data/*.yml`.
  Called by `generate-data.sh`.

- `scripts/utils/src/extract-engine-proc-docs.ts`
  Extracts Fallout engine procedure names and docs JSON for the TSSL transpiler and TypeScript plugin.
  Called by `generate-data.sh`.

- `scripts/utils/src/yaml2json.ts`
  Converts tmLanguage YAML to JSON, expanding shorthand `name` inheritance. Called by `syntaxes-to-json.sh`.

- `scripts/utils/src/generate-ksh.ts`, `scripts/utils/src/generate-udl.ts`, `scripts/utils/src/generate-geany.ts`
  Generate the Kate KSyntaxHighlighting, Notepad++ UDL, and Geany filetype bundles. Called by `build-editors.sh`.

- **`editor-captures.ts`**, **`generate-editor-queries.ts`**, **`check-editor-captures.ts`**
  Per-editor highlight queries. The canonical `grammars/<g>/queries/highlights.scm` uses Neovim capture
  names; `generate-editor-queries.ts --bundle-dir <dir>` writes Helix and Zed variants into the grammar
  bundle using the mapping tables in `editor-captures.ts`, which also vendors the capture set each editor
  styles. `check-editor-captures.ts [--zed]` re-derives those sets upstream and reports drift (manual -
  needs the network). Guarded by `scripts/utils/test/editor-captures.test.ts`, which asserts every emitted
  capture is one the target styles.

- `scripts/utils/src/generate-td-lib-blocklist.ts`
  Regenerates the ES-lib completion blocklist in `plugins/td-plugin/src/filter-completions.ts` from the installed
  TypeScript's lib reference chain. Invoked via `pnpm regen:td-blocklist`.

- `scripts/utils/src/language-defs.ts`
  Shared language metadata and keyword collection for the editor-bundle generators (library module, no CLI).

- `scripts/utils/src/yaml-helpers.ts`
  Shared YAML/text helpers (strict duplicate-rejecting parsing, block scalars, deterministic sort and directory walk)
  for the data-update tools (library module).

- `scripts/utils/src/validate-helpers.ts`
  Shared runtime validation helpers asserting types at `YAML.parse()` boundaries for the ie-update/fallout-update
  tools (library module).

- `scripts/utils/src/vitest-coverage-config.ts`
  Shared vitest `coverage` block factored out of the per-package unit-test configs (library module).

- `scripts/utils/src/weidu-binary.ts`
  Resolves the WeiDU binary the differential suites drive - WEIDU_BIN, then PATH, then `ensure-weidu.sh` -
  with no skip path, so an absent binary is provisioned rather than turning a gate green (library module).
