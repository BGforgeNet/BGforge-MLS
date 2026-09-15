# Ignore Files and Lint Policy

Each ignore mechanism explains itself at the site: `.gitignore`, `.vscodeignore` and `.oxlintrc.json` carry a
comment beside every non-obvious pattern, and those files are the authority on what is excluded. Read them first.

This document holds only what no single file can state - facts that span two of them, behaviour of the tools that
read them, and measurements someone would otherwise have to redo. Its last section is lint policy, which is not an
ignore mechanism but is decided in the same config.

| Mechanism              | Controls                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| `.gitignore`           | What git tracks (plus nested `.gitignore` files beside the build and test output they cover) |
| `.vscodeignore`        | What ships in the VSIX                                                                       |
| `package.json` `files` | What ships in each published npm tarball                                                     |
| `.editorconfig`        | Indent and line width; oxfmt reads it, so it is where the 120-column limit lives             |
| `.oxfmtrc.json`        | Per-filetype indent, and the authoritative list of files excluded from formatting            |
| `.oxlintrc.json`       | Lint categories, per-rule severity, and per-directory idiom exemptions                       |

## What ships in the VSIX

`.vscodeignore` is a **denylist**: everything ships unless a pattern excludes it, so the interesting half - what
ships - appears nowhere in that file. These are included because nothing excludes them:

- `package.json`, `README.md`, `LICENSE.txt` - auto-included by vsce
- `SECURITY.md` - the vulnerability-reporting policy
- `client/package.json`, `client/out/` - extension entry point, webview bundles, codicons
- `client/src/**/*.html`, `client/src/**/*.css` - webview HTML/CSS templates
- `server/package.json`, `server/LICENSE.txt`, `server/out/` - LSP server bundle, data JSONs, WASM parsers,
  td-runtime.d.ts, and the Fallout SSL compiler (WASM, loaded via `fork()`), which the build copies in
- `server/node_modules/esbuild-wasm/` - esbuild WASM, used by transpilers (runtime files only: `esbuild.wasm`,
  `bin/esbuild`, `lib/main.js`, `wasm_exec*.js`, `package.json`)
- `language-configurations/*.json` - language bracket/comment rules
- `snippets/*.json` - code snippets
- `syntaxes/*.json` - TextMate grammars
- `themes/bgforge-*.json`, `themes/seti.woff`, `themes/icons/` - BGforge themes
- `resources/bgforge.png` - extension icon

One more entry ships although `.vscodeignore` excludes root `node_modules/`: `node_modules/bgforge-tssl-plugin/` and
`node_modules/bgforge-td-plugin/`, which `scripts/package.sh` adds to the VSIX after vsce has packaged it. That
script's header describes the steps it takes to make pnpm's layout packageable.

A denylist fails open, so this list is orientation, not a guarantee: `scripts/verify-package-contents.sh` runs at
the end of `package.sh` and fails the build when an unexpected path or size appears in the VSIX. That guard, not
this list, is what actually holds.

## What ships in the npm tarballs

The published packages - `@bgforge/mls-server`, `@bgforge/binary`, `@bgforge/format`, `@bgforge/transpile` and
`@bgforge/tssl` - take the opposite shape: each `package.json` `files` field is an **allowlist**, so a tarball carries
only what that field names plus the files npm always includes. Neither `.gitignore` nor `.vscodeignore` affects them.

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

## Lint rule policy

Which rules run beyond the categories `.oxlintrc.json` enables, and which were measured and left out. A rule relaxed
for one file is an `overrides` entry in `.oxlintrc.json`, never an `ignorePatterns` entry, and its comment there says
why.

### The type-aware pass runs separately

`pnpm lint:types` is a second oxlint run with `--type-aware`, backed by the `oxlint-tsgolint` binary. It enables
only the promise-safety rules named in the `lint:types` script in `package.json` and allows everything else,
because the full type-aware set is dominated by `prefer-readonly-parameter-types` and the `no-unsafe-*` family,
whose findings are almost all style. The rules it does run cannot be expressed syntactically. It is wired into `scripts/test.sh` Phase 1 and pre-commit, and it covers every
workspace. What its backend requires of a tsconfig, and how a config it refuses reads as clean, is in the
`oxlint-tsgolint` entry of [dependencies.md](dependencies.md).

**`no-unnecessary-type-assertion` is not in the enabled set, and cannot be.** Its 318 findings were swept in one
pass and 269 were genuine - mostly `as unknown as T` double casts. The other 49 are assertions `tsc` REQUIRES: it
reports a non-null `!` on an indexed access as unnecessary where the package typecheck then fails with
"Object is possibly 'undefined'". `compilers/bcs/test/ids-tables.ts:31` is the smallest reproducer - `value(text:
string)` fed `match[1]`, which is `string | undefined` under the `noUncheckedIndexedAccess` that
`tsconfig.base.json` sets. Enabling the rule would therefore stand permanently red on 49 sites, and its `--fix`
produces a tree that does not compile. The 49 are concentrated in `shared/dialog-*`; re-test after a
tsgolint bump, since this is a divergence between its program and `tsc`, not a property of the code.

### The test-lint pass, and what it leaves out

`pnpm lint:tests` runs the vitest plugin with the named allowlist in the `lint:tests` script in `package.json`. The
plugin is not enabled wholesale: with the repo's categories, its full set produces roughly 16000 findings, nearly all
style (`prefer-expect-assertions` alone is 7559).

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
