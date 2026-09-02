# Ignore Files

Each ignore mechanism explains itself at the site: `.gitignore`, `.vscodeignore` and `.oxlintrc.json` carry a
comment beside every non-obvious pattern, and those files are the authority on what is excluded. Read them first.

This document holds only what no single file can state - facts that span two of them, behaviour of the tools that
read them, and measurements someone would otherwise have to redo.

| Mechanism        | Controls                                                                          |
| ---------------- | --------------------------------------------------------------------------------- |
| `.gitignore`     | What git tracks (plus a `.gitignore` per grammar directory, for test artifacts)   |
| `.vscodeignore`  | What ships in the VSIX                                                            |
| `.editorconfig`  | Indent and line width; oxfmt reads it, so it is where the 120-column limit lives  |
| `.oxfmtrc.json`  | Per-filetype indent, and the authoritative list of files excluded from formatting |
| `.oxlintrc.json` | Lint categories, per-rule severity, and per-directory idiom exemptions            |

## What ships in the VSIX

`.vscodeignore` is a **denylist**: everything ships unless a pattern excludes it, so the interesting half - what
ships - appears nowhere in that file. These are included because nothing excludes them:

- `package.json`, `README.md`, `LICENSE.txt` - auto-included by vsce
- `client/package.json`, `client/out/` - extension entry point, webview bundles, codicons
- `client/src/**/*.html`, `client/src/**/*.css` - webview HTML/CSS templates
- `server/package.json`, `server/out/` - LSP server bundle, data JSONs, WASM parsers, td-runtime.d.ts
- `server/node_modules/sslc-emscripten-noderawfs/` - Fallout SSL compiler (WASM), loaded via `fork()`
- `server/node_modules/esbuild-wasm/` - esbuild WASM, used by transpilers (runtime files only: `esbuild.wasm`,
  `bin/esbuild`, `lib/main.js`, `wasm_exec*.js`, `package.json`)
- `language-configurations/*.json` - language bracket/comment rules
- `snippets/*.json` - code snippets
- `syntaxes/*.json` - TextMate grammars
- `themes/bgforge-*.json`, `themes/seti.woff`, `themes/icons/` - BGforge themes
- `resources/bgforge.png` - extension icon

A denylist fails open, so this list is orientation, not a guarantee: `scripts/verify-package-contents.sh` runs at
the end of `package.sh` and fails the build when an unexpected path or size appears in the VSIX. That guard, not
this list, is what actually holds.

### Packaging notes

`scripts/package.sh` handles three pnpm/vsce compatibility issues:

1. **pnpm symlinks**: `server/node_modules/` entries are pnpm symlinks that vsce's zip writer (yazl) crashes on. The script derefs runtime deps (`sslc-emscripten-noderawfs`, `esbuild-wasm`), strips all remaining symlinks and pnpm internal dirs, then restores via `pnpm install` after packaging.

2. **`--no-dependencies`**: vsce's `npm list --production` check fails with pnpm's node_modules layout. The `--no-dependencies` flag skips this check.

3. **TS plugin injection**: vsce with `--no-dependencies` does not include root `node_modules/` contents regardless of `.vscodeignore` patterns. The TS plugins (`bgforge-tssl-plugin`, `bgforge-td-plugin`) are injected into the VSIX via `zip -g` after packaging, using a `.pkg-inject/` temp directory.

The script runs the prepublish build first (with full deps available), then uses `SKIP_PREPUBLISH=1` to skip the rebuild when vsce invokes `vscode:prepublish` after the strip.

## Formatting exclusions

`.oxfmtrc.json` `ignorePatterns` is the authoritative list of files excluded from formatting. It holds the repo's
generated artifacts, so their canonical format stays whatever their generator emits - running `oxfmt` over them
would only be undone on the next regeneration. Generated source and data files carry an `Auto-generated ... Do not
hand-edit` marker on their first line. The file is strict JSON and cannot carry comments, which is why its
rationale lives here rather than beside the patterns.

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

## Relaxing a lint rule

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
real defects when first enabled. It is wired into `scripts/test.sh` Phase 1 and pre-commit.

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

### The test-lint pass, and what it leaves out

`pnpm lint:tests` runs the vitest plugin with a named allowlist - committed `.only`, duplicate titles, duplicate
and misordered hooks, the two structural checks, and `no-conditional-expect`. The plugin is not enabled wholesale:
with the repo's categories, its full set produces roughly 16000 findings, nearly all style
(`prefer-expect-assertions` alone is 7559).

`no-conditional-expect` was cleared across 98 sites rather than suppressed. Three shapes came out of it, and the
same three are what a new finding will be: an `if` re-checking what an earlier `expect` established purely to
narrow a type, which becomes `assert(...)` from vitest (it narrows discriminated unions, type-guard calls and
truthiness alike); a genuinely two-sided expectation in a table-driven helper or corpus loop, where the condition
belongs in the expected VALUE rather than in control flow around the assertion; and an `expect` inside a `catch`,
which never runs once the call stops throwing - capture the error into a variable and assert after the block.
Note that a matcher inside a ternary (`isEnum ? expect.stringMatching(...) : x`) still counts as a conditional
expect; normalise the actual value instead.

Rules measured against this repo and deliberately left out, so nobody has to re-derive them. The last two come
from the `promise` and `node` plugins, which are likewise not enabled wholesale:

| Rule                    | Findings | Why not enabled                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vitest/expect-expect`  | 154      | False positives. Assertions in this suite routinely sit in a per-file helper (`expectSite(...)`), which the rule cannot follow, so it reports the calling test as assertion-free.                                                                                                                                                                                            |
| `promise/always-return` | 19       | False positives against this codebase's fire-and-forget idiom, `void promise.then(sideEffect)`. A terminal `.then` doing work has nothing to return, and the `void` already states the intent the rule is asking for.                                                                                                                                                        |
| `node/no-sync`          | 1763     | Correct in the CLIs, scripts and tests that make up most of it. The ~50 under `server/src` are the ones that could matter, and they sit on on-demand handler paths (call hierarchy, static loading) behind a provider interface that is synchronous by design - converting them is an architecture change, not a lint fix. Re-open if the server ever shows request latency. |
