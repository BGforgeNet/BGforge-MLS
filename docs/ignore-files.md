# Ignore Files

This project uses five ignore mechanisms. Each serves a different purpose: what goes into git, what ships in the VSIX, what gets linted, and what gets formatted.

## .gitignore

Controls what git tracks. Most build output is ignored; checked-in data JSONs are exceptions.

### Build output

| Pattern        | What it ignores                                                  |
| -------------- | ---------------------------------------------------------------- |
| `client/out`   | Client esbuild bundles (extension.js, webviews, etc.)            |
| `server/out/*` | Server esbuild bundle, WASM files, generated runtime files       |
| `cli/*/out`    | CLI bundles (format-cli.js, transpile.js, bin-cli.js)            |
| `*.wasm`       | Tree-sitter WASM files (built from C sources by `build:grammar`) |
| `coverage/`    | Vitest coverage reports                                          |

### Checked-in data (exceptions to `server/out/*`)

These JSON files are generated from `server/data/*.yml` by `generate-data.sh` but are checked in so that tests and typechecks work on a clean checkout without a build step.

| Pattern                                         | Contents                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `!server/out/completion.*.json`                 | Autocomplete item lists (one per language)           |
| `!server/out/hover.*.json`                      | Hover documentation (one per language)               |
| `!server/out/signature.*.json`                  | Signature help parameter hints                       |
| `!server/out/fallout-ssl-engine-proc-docs.json` | Engine procedure docs for the TSSL TypeScript plugin |

### Generated source

| Pattern                         | What it ignores                                               |
| ------------------------------- | ------------------------------------------------------------- |
| `grammars/*/src/`               | Tree-sitter generated C parser sources                        |
| `server/src/*/tree-sitter.d.ts` | Generated TypeScript types for grammar nodes (all 4 grammars) |

### Third-party and temporary

| Pattern                                      | What it ignores                                          |
| -------------------------------------------- | -------------------------------------------------------- |
| `node_modules`                               | pnpm dependencies (root, client, server, cli workspaces) |
| `client/node_modules`, `server/node_modules` | Workspace-specific node_modules                          |
| `external/*`                                 | Cloned third-party mod repos used as test fixtures       |
| `.vscode-test/`                              | Downloaded VSCode binaries for E2E tests                 |
| `tmp`                                        | Scratch directory                                        |
| `/test`                                      | Root-level test directory                                |
| `.reports/`                                  | Analysis reports                                         |
| `dist/`                                      | Build artifact directory (VSIX, editor bundles)          |
| `*.log`, `*.vsix`                            | Log files and built extension packages                   |

The `external/` directory has four allowlisted text files (`!external/fallout.txt`, etc.) that list which repos to clone and what to exclude.

## .vscodeignore

Controls what ships in the VSIX extension package. Uses a **blocklist** strategy: everything is included by default, then patterns exclude what shouldn't ship.

### Excluded: dev infrastructure

| Pattern                                                 | What it excludes                                |
| ------------------------------------------------------- | ----------------------------------------------- |
| `.claude/`                                              | AI assistant config                             |
| `.editorconfig`                                         | Editor config                                   |
| `.oxlintrc.json`                                        | Linting configuration                           |
| `.github/`                                              | CI workflows                                    |
| `.reports/`, `.vscode/`, `.vscode-test/`                | Dev/test directories                            |
| `CLAUDE.md`, `CONTRIBUTING.md`                          | Dev documentation                               |
| `knip.ts`, `tsconfig.json`                              | Linting and build config                        |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`                 | Package manager files                           |
| `dist/`                                                 | Build artifact directory (VSIX, editor bundles) |
| `*.vsix`, `*.tgz`, `*.log`, `**/*.map`                  | Built packages, logs, source maps               |
| `*.tmbundle`, `*.zip`                                   | Generated bundles (tmbundle, UDL, KSH archives) |
| `bgforge-mls-notepadpp-udl*/`, `bgforge-mls-kate-ksh*/` | Generated editor asset directories              |

### Excluded: dev-only directories

| Pattern                      | What it excludes                                    |
| ---------------------------- | --------------------------------------------------- |
| `cli/`, `coverage/`, `docs/` | CLI packages, coverage reports, documentation       |
| `external/`, `grammars/`     | Test fixtures (~70 MB), tree-sitter grammar sources |
| `plugins/`                   | TypeScript plugin sources (built to node_modules/)  |
| `scripts/`, `test/`, `tmp/`  | Build scripts, tests, scratch                       |
| `transpilers/`               | Transpiler documentation                            |

### Excluded: source code and dev files

| Pattern                                                               | What it excludes                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `client/src/**/*.ts`                                                  | Client TypeScript source (HTML/CSS webview assets are kept)   |
| `client/test/`, `client/testFixture/`, `client/out/test/`             | Client test files and fixtures                                |
| `client/scripts/`, `client/tsconfig*.json`, `client/vitest.config.ts` | Client dev files                                              |
| `client/node_modules/`                                                | Client dev dependencies                                       |
| `server/src/`, `server/data/`                                         | Server TypeScript source, YAML data files                     |
| `server/test/`, `server/scripts/`, `server/coverage/`                 | Server test files and dev artifacts                           |
| `server/tsconfig*.json`, `server/vitest.config.ts`                    | Server dev config                                             |
| `syntaxes/*.yml`                                                      | Source YAML for TextMate grammars (only .json ships)          |
| `themes/vscode-monokai.json`, `themes/vs-seti-icon-theme.json`        | Upstream theme sources                                        |
| `**/README.md`                                                        | READMEs in subdirectories (root README auto-included by vsce) |

### Excluded: node_modules

| Pattern                                                    | What it excludes                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| `server/node_modules/esbuild-wasm/esm/`                    | ESM browser builds (not used in Node.js)                                   |
| `server/node_modules/esbuild-wasm/lib/browser*`            | CJS browser builds (not used in Node.js)                                   |
| `server/node_modules/esbuild-wasm/**/*.d.ts`               | TypeScript definitions (not needed at runtime)                             |
| `server/node_modules/esbuild-wasm/LICENSE.md`, `README.md` | Documentation files                                                        |
| `server/node_modules/.ignored*/`                           | pnpm internal dirs surviving after symlink strip                           |
| `node_modules/`                                            | All root dependencies (TS plugins injected by `package.sh` post-packaging) |
| `.pkg-inject/`                                             | Temp directory used by `package.sh` for zip injection                      |

### Included: runtime files (not excluded, ship by default)

These are included implicitly (not excluded by any pattern):

- `package.json`, `README.md`, `LICENSE.txt` - auto-included by vsce
- `client/package.json`, `client/out/` - extension entry point, webview bundles, codicons
- `client/src/**/*.html`, `client/src/**/*.css` - webview HTML/CSS templates
- `server/package.json`, `server/out/` - LSP server bundle, data JSONs, WASM parsers, td-runtime.d.ts
- `server/node_modules/sslc-emscripten-noderawfs/` - Fallout SSL compiler (WASM), loaded via `fork()`
- `server/node_modules/esbuild-wasm/` - esbuild WASM, used by transpilers (runtime files only: `esbuild.wasm`, `bin/esbuild`, `lib/main.js`, `wasm_exec*.js`, `package.json`)
- `language-configurations/*.json` - language bracket/comment rules
- `snippets/*.json` - code snippets
- `syntaxes/*.json` - TextMate grammars
- `themes/bgforge-*.json`, `themes/seti.woff`, `themes/icons/` - BGforge themes
- `resources/bgforge.png` - extension icon

### Packaging notes

`scripts/package.sh` handles three pnpm/vsce compatibility issues:

1. **pnpm symlinks**: `server/node_modules/` entries are pnpm symlinks that vsce's zip writer (yazl) crashes on. The script derefs runtime deps (`sslc-emscripten-noderawfs`, `esbuild-wasm`), strips all remaining symlinks and pnpm internal dirs, then restores via `pnpm install` after packaging.

2. **`--no-dependencies`**: vsce's `npm list --production` check fails with pnpm's node_modules layout. The `--no-dependencies` flag skips this check.

3. **TS plugin injection**: vsce with `--no-dependencies` does not include root `node_modules/` contents regardless of `.vscodeignore` patterns. The TS plugins (`bgforge-tssl-plugin`, `bgforge-td-plugin`) are injected into the VSIX via `zip -g` after packaging, using a `.pkg-inject/` temp directory.

The script runs the prepublish build first (with full deps available), then uses `SKIP_PREPUBLISH=1` to skip the rebuild when vsce invokes `vscode:prepublish` after the strip.

## .editorconfig

Oxfmt (and VSCode) use `.editorconfig` for formatting.

| Pattern             | Setting                                                            |
| ------------------- | ------------------------------------------------------------------ |
| `[*]`               | `indent_style = space`, `indent_size = 4`, `max_line_length = 120` |
| `[*.{yml,yaml,md}]` | `indent_size = 2`                                                  |

## .oxlintrc.json

Oxlint configuration.

| Field            | Purpose                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `rules`          | Categories: `correctness`, `suspicious`, `pedantic`, `perf`, `style` (all set to `warn`) |
| `overrides`      | Grammar files get tree-sitter globals; server gets custom `no-showmessage` rule          |
| `ignorePatterns` | Excludes: `node_modules`, `out`, `*.d.ts`, `user-messages.ts`                            |
| `jsPlugins`      | Custom plugin for banning direct LSP showMessage calls                                   |

### Tree-sitter globals

Grammar files (`grammars/**/*.js`) need these globals: `grammar`, `seq`, `choice`, `repeat`, `repeat1`, `optional`, `prec`, `token`, `field`, `alias`, `LANGUAGE`, `LRULE`.

### Custom rule

The project has a custom oxlint plugin (`.oxlint/oxlint-plugin-no-showmessage.ts`) that bans direct `connection.window.showMessage` calls in server code. Use the wrapper functions from `user-messages.ts` instead.

## Grammar .gitignore files

Each grammar directory (`grammars/fallout-ssl/`, `grammars/weidu-baf/`, `grammars/weidu-d/`, `grammars/weidu-tp2/`) has its own `.gitignore` for test artifacts.

All grammar `.gitignore` files exclude:

| Pattern                     | Purpose                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `test/samples-formatted/`   | Temporary output from format tests (compared against `test/samples-expected/` which IS committed) |
| `test/samples-formatted-2/` | Second-pass format output for idempotency testing                                                 |

The `fallout-ssl` grammar has additional ignores for tree-sitter's multi-language build artifacts (Rust, Go, Python, Swift, Zig, C compiled objects, etc.) since it serves as the primary grammar development workspace.
