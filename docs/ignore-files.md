# Ignore Files

This project uses six ignore mechanisms. Each serves a different purpose: what goes into git, what ships in the VSIX, what gets linted, and what gets formatted.

## .gitignore

Controls what git tracks. Most build output is ignored; checked-in data JSONs are exceptions.

### Build output

| Pattern                                       | What it ignores                                                  |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `client/out`                                  | Client esbuild bundles (extension.js, webviews, etc.)            |
| `server/out/*`                                | Server esbuild bundle, WASM files, generated runtime files       |
| `transpilers/out`, `format/out`, `binary/out` | Library + CLI bundles for the published `@bgforge/*` packages    |
| `plugins/*/out`                               | TypeScript Language Service plugin bundles                       |
| `*.wasm`                                      | Tree-sitter WASM files (built from C sources by `build:grammar`) |
| `coverage/`                                   | Vitest coverage reports                                          |

### Checked-in data (exceptions to `server/out/*`)

These JSON files are generated from `server/data/*.yml` by `generate-data.sh` but are checked in so that tests and typechecks work on a clean checkout without a build step.

| Pattern                                         | Contents                                             |
| ----------------------------------------------- | ---------------------------------------------------- |
| `!server/out/completion.*.json`                 | Autocomplete item lists (one per language)           |
| `!server/out/hover.*.json`                      | Hover documentation (one per language)               |
| `!server/out/signature.*.json`                  | Signature help parameter hints                       |
| `!server/out/fallout-ssl-engine-proc-docs.json` | Engine procedure docs for the TSSL TypeScript plugin |

### Generated source

| Pattern                         | What it ignores                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------- |
| `grammars/*/src/`               | Tree-sitter generated C parser sources                                                |
| `server/src/*/tree-sitter.d.ts` | Generated node-type declarations (all four LSP grammars; rebuilt by `generate:types`) |

### Third-party and temporary

| Pattern                                      | What it ignores                                    |
| -------------------------------------------- | -------------------------------------------------- |
| `node_modules`                               | pnpm dependencies (root and all workspaces)        |
| `client/node_modules`, `server/node_modules` | Workspace-specific node_modules                    |
| `external/*`                                 | Cloned third-party mod repos used as test fixtures |
| `.vscode-test/`                              | Downloaded VSCode binaries for E2E tests           |
| `tmp`                                        | Scratch directory                                  |
| `/test`                                      | Root-level test directory                          |
| `.reports/`                                  | Analysis reports                                   |
| `dist/`                                      | Build artifact directory (VSIX, editor bundles)    |
| `*.log`, `*.vsix`                            | Log files and built extension packages             |

The `external/` directory has four allowlisted text files (`!external/fallout.txt`, etc.) that list which repos to clone and what to exclude.

## .vscodeignore

Controls what ships in the VSIX extension package. Uses a **blocklist** strategy: everything is included by default, then patterns exclude what shouldn't ship.

### Excluded: dev infrastructure

| Pattern                                         | What it excludes                                |
| ----------------------------------------------- | ----------------------------------------------- |
| `.claude/`                                      | AI assistant config                             |
| `.editorconfig`                                 | Editor config                                   |
| `.oxlintrc.json`                                | Linting configuration                           |
| `.github/`                                      | CI workflows                                    |
| `.reports/`, `.vscode/`, `.vscode-test/`        | Dev/test directories                            |
| `CONTRIBUTING.md`, agent instruction files      | Dev documentation                               |
| `knip.ts`, `tsconfig.json`                      | Linting and build config                        |
| `pnpm-lock.yaml`, `pnpm-workspace.yaml`         | Package manager files                           |
| `dist/`                                         | Build artifact directory (VSIX, editor bundles) |
| `*.vsix`, `*.tgz`, `*.log`, `**/*.map`          | Built packages, logs, source maps               |
| `*.tmbundle`, `*.zip`                           | Generated bundles (tmbundle, UDL, KSH archives) |
| `bgforge-mls-notepadpp*/`, `bgforge-mls-kate*/` | Generated editor asset directories              |

### Excluded: dev-only directories

| Pattern                     | What it excludes                                                    |
| --------------------------- | ------------------------------------------------------------------- |
| `coverage/`, `docs/`        | Coverage reports, documentation                                     |
| `external/`, `grammars/`    | Test fixtures (~70 MB), tree-sitter grammar sources                 |
| `plugins/`                  | TypeScript plugin sources (injected by `package.sh` post-packaging) |
| `scripts/`, `test/`, `tmp/` | Build scripts, tests, scratch                                       |
| `transpilers/`              | Transpiler sources and per-package docs                             |

### Excluded: source code and dev files

| Pattern                                                               | What it excludes                                              |
| --------------------------------------------------------------------- | ------------------------------------------------------------- |
| `client/src/**/*.ts`                                                  | Client TypeScript source (HTML/CSS webview assets are kept)   |
| `client/test/`, `client/testFixture/`, `client/out/test/`             | Client test files and fixtures                                |
| `client/scripts/`, `client/tsconfig*.json`, `client/vitest.config.ts` | Client dev files                                              |
| `client/node_modules/`, `client/coverage/`                            | Client dev dependencies and coverage reports                  |
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

## .oxfmtrc.json

Oxfmt configuration. `overrides` set the indent width per file type: 2-space for YAML and Markdown, 4-space for JSON
and TypeScript. Line width comes from `.editorconfig` above.

`ignorePatterns` is the authoritative list of files excluded from formatting. It holds the repo's generated artifacts,
so their canonical format stays whatever their generator emits - running `oxfmt` over them would only be undone on the
next regeneration. Generated source and data files carry an `Auto-generated ... Do not hand-edit` marker on their first
line.

Two guards keep the list honest:

| Guard                                                   | Checks                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------- |
| `scripts/utils/test/oxfmt-generated-exclusions.test.ts` | Every marker-carrying file stays excluded, so the list cannot drift |
| `scripts/utils/test/data-json-well-formed.test.ts`      | Every committed data JSON parses, the oxfmt-excluded ones included  |

### The oxfmt/oxlint exclusion asymmetry is deliberate

`.oxlintrc.json` `ignorePatterns` is a much smaller set and deliberately does **not** mirror the one above. Generated
files stay linted: a linter catches real generator bugs, whereas a formatter only fights the generator. Do not "align"
the two lists.

The reach of that promise stops at `.gitignore`, which oxlint honours when it walks the tree. The generated
tree-sitter declarations (`server/src/*/tree-sitter.d.ts`, `grammars/*/src/`) are gitignored build output, so no
full-tree run ever reaches them however the lint config is written - linting them takes an explicit path argument.
The asymmetry therefore covers generated files that are **tracked** (the `server/out/` data JSONs, the
`shared/syntax-types/` modules), not gitignored build output.

## .oxlintrc.json

Oxlint configuration.

| Field            | Purpose                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| `categories`     | `correctness`, `suspicious`, `pedantic`, `perf`, `style`, all set to `error`          |
| `rules`          | Per-rule severity and the disabled set, each entry carrying its reason inline         |
| `overrides`      | Grammar globals, the custom `no-showmessage` rule, and per-directory idiom exemptions |
| `ignorePatterns` | Excludes `node_modules` and `out` - build output only                                 |
| `jsPlugins`      | Custom plugin for banning direct LSP showMessage calls                                |

A rule that must be relaxed for one file gets an `overrides` entry naming that rule, never an `ignorePatterns`
entry: the latter drops the file from every enabled rule to silence one. `server/src/user-messages.ts` is the worked
example - it is the wrapper the `no-showmessage` rule points callers at, so that single rule is switched off for
it there. The render harnesses and the ambient `*-runtime.d.ts` declarations were both converted from blanket
exclusions to rule-scoped overrides for the same reason.

### The type-aware pass runs separately

`pnpm lint:types` is a second oxlint run with `--type-aware`, backed by the `oxlint-tsgolint` binary. It enables
exactly three rules - `no-floating-promises`, `no-misused-promises`, `await-thenable` - and allows everything else,
because the full type-aware set is dominated by `prefer-readonly-parameter-types` and the `no-unsafe-*` family
(~14000 findings, almost all style). The three it does run cannot be expressed syntactically, and they found four
real defects when first enabled. It takes about four seconds and is wired into `scripts/test.sh` Phase 1 and
pre-commit.

It covers every workspace. It briefly did not: both TS Language Service plugins pinned `moduleResolution: node`,
removed in TS 7, so their programs failed to construct and neither `src` tree was analysed. They now use `node16`,
which resolves and emits CommonJS in a package that declares no `"type"` - so `export = init` stays legal - and the
shipped bundle never depended on the setting anyway, since `scripts/build-ts-plugin.sh` uses esbuild `--format=cjs`.

A program that fails to construct reports zero findings, not an error per file: `client` and `server` were in that
state until their `rootDir` was made explicit, and read as clean while nothing had been analysed. Treat a sudden
drop to zero findings as a config failure until the run's `tsconfig-error` count is confirmed to be zero.

**`no-unnecessary-type-assertion` is not in the enabled set, and cannot be.** Its 318 findings were swept in one
pass and 269 were genuine - mostly `as unknown as T` double casts. The other 49 are assertions `tsc` REQUIRES: it
reports a non-null `!` on an indexed access as unnecessary where the package typecheck then fails with
"Object is possibly 'undefined'". `compilers/bcs/test/ids-tables.ts:31` is the smallest reproducer - `value(text:
string)` fed `match[1]`, which is `string | undefined` under the `noUncheckedIndexedAccess` that
`tsconfig.base.json` sets. Enabling the rule would therefore stand permanently red on 49 sites, and its `--fix`
produces a tree that does not compile. The 49 are concentrated in `shared/dialog-*`; re-test after a
tsgolint bump, since this is a divergence between its program and `tsc`, not a property of the code.

### The test-lint pass, and the two rules it leaves out

`pnpm lint:tests` runs the vitest plugin with a named allowlist - committed `.only`, duplicate titles, duplicate
and misordered hooks, and the two structural checks. The plugin is not enabled wholesale: with the repo's
categories, its full set produces roughly 16000 findings, nearly all style (`prefer-expect-assertions` alone is
7559).

Two rules were measured and deliberately left out, so nobody has to re-derive them:

| Rule                           | Findings | Why not enabled                                                                                                                                                                                                                                                                         |
| ------------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest/expect-expect`         | 154      | False positives. Assertions in this suite routinely sit in a per-file helper (`expectSite(...)`), which the rule cannot follow, so it reports the calling test as assertion-free.                                                                                                       |
| `vitest/no-conditional-expect` | 98       | Real, but not a config change. Most sites are an `if` that re-checks something an earlier `expect` already established, purely to narrow the type; a few have no such guard and would pass asserting nothing. Clearing them means replacing ~98 narrowings by hand, one judgement each. |

### Tree-sitter globals

Grammar files (`grammars/**/*.js`) need these globals: `grammar`, `seq`, `choice`, `repeat`, `repeat1`, `optional`, `prec`, `token`, `field`, `alias`, `LANGUAGE`, `LRULE`.

### Custom rule

The project has a custom oxlint plugin (`.oxlint/oxlint-plugin-no-showmessage.mjs`) that bans direct `connection.window.showMessage` calls in server code. Use the wrapper functions from `user-messages.ts` instead.

## Grammar .gitignore files

Each grammar directory (`grammars/fallout-ssl/`, `grammars/weidu-baf/`, `grammars/weidu-d/`, `grammars/weidu-tp2/`) has its own `.gitignore` for test artifacts.

All grammar `.gitignore` files exclude:

| Pattern                     | Purpose                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `test/samples-formatted/`   | Temporary output from format tests (compared against `test/samples-expected/` which IS committed) |
| `test/samples-formatted-2/` | Second-pass format output for idempotency testing                                                 |

The `fallout-ssl` grammar has additional ignores for tree-sitter's multi-language build artifacts (Rust, Go, Python, Swift, Zig, C compiled objects, etc.) since it serves as the primary grammar development workspace.
