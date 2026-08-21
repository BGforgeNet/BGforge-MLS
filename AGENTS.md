# AGENTS.md

This file provides guidance to AI agents (Claude, Gemini, etc.) when working with code in this repository.

## Supply-chain artifacts

Release provenance (SBOM, SLSA), the static-analysis workflows, and two deliberate NON-additions - no
self-hosted secret scanner, no `dependabot.yml` - are documented in `docs/supply-chain.md`. Read it before
adding security tooling: both omissions are choices with recorded reasons, not gaps.

## Important Rules

- **Use `SyntaxType` enum for tree-sitter node types.** Never hardcode strings like `"action_copy"`. In `server/`, import from `./syntax-type` (a re-export shim); in `@bgforge/format`, import from `../../../shared/syntax-types/<grammar>` (the canonical home). Use `SyntaxType.ActionCopy`. The enum is generated from the grammar (a runtime `syntax-type.ts` split out of the generated `tree-sitter.d.ts` so any bundler resolves it). See _Tree-Sitter Type Generation_ below.
- **External library packaging:** Libraries imported by transpiler files (iets, folib) must use **named re-exports** (`export { X } from './module'`), not star re-exports (`export * from './module'`). Ambient declarations (`declare function`, `declare const`) must live in `.d.ts` files, not `.ts` files. See folib's `src/index.ts` for the correct pattern.
- **URI normalization:** All URIs entering the provider system are normalized via `normalizeUri()` from `core/normalized-uri.ts`. The `ProviderRegistry` handles this at the gateway. If you add new URI-accepting methods to the registry, normalize them. If you use URIs as Map/Set keys elsewhere, use `NormalizedUri` branded type.
- **User-facing messages:** Never call `connection.window.showInformationMessage/showWarningMessage/showErrorMessage` directly in server code. Use `showInfo()`, `showWarning()`, `showError()`, or `showErrorWithActions()` from `user-messages.ts` - they auto-decode `file://` URIs to readable paths. An oxlint rule enforces this.
- **Temporary artifacts:** Put transient test/build files under the repo-level `tmp/` directory (or `os.tmpdir()` when system temp is required). Do not create ad hoc temp directories under source trees like `server/test/`, `binary/test/`, or `scripts/**`.
- **Webview CSP - styles need `cspSource`, not a bare nonce.** A webview's `style-src` must include `{{cspSource}}`. VS Code's wrapped webview silently drops a `style-src 'nonce-...'` stylesheet that lacks `cspSource` (raw Chromium honors it, so headless/standalone renders pass while the real panel renders fully unstyled). Load CSS as `webview.asWebviewUri()` `<link>` elements with `style-src {{cspSource}}` (keep the nonce for `script-src` only); add each CSS dir to `localResourceRoots`. See `docs/architecture.md` (Webview CSP); guarded by `client/test/webview-csp.test.ts`.
- **Binary-editor webview changes can be rendered - don't fall back to a sketch without checking.** A headless Playwright harness in `binary-editor/test/harness/` loads the real `App.svelte` bundle in Chromium and writes per-format PNG screenshots (e.g. `render-pro-eff.mts` -> `shot-pro.png` + `shot-eff.png`, `render-itm.mts`, `render-spl.mts`, `render-cre.mts`, `render-map.mts`, `render-primitives.mts`). For any visual/CSS/layout change to the binary editor, render and inspect the screenshot rather than reasoning about the cascade blind. Run order: `cd binary && pnpm build` (only if `binary/src` changed), then `pnpm exec tsx binary-editor/test/harness/build.mts` (rebuilds `app.html` after any webview/Svelte/`styles.css` edit), then a driver `pnpm exec tsx binary-editor/test/harness/render-pro-eff.mts`. `playwright` is a pinned devDep; the Chromium browser it drives is the environment prereq (`pnpm exec playwright install chromium`). The drivers assert through PASS/FAIL gates and now run in CI as a regression suite via the separate `Harness` workflow (`scripts/test-harness.sh` - both editors' harnesses); they stay excluded from `pnpm test`/`pnpm test:all`, which run browserless. See `binary-editor/test/harness/README.md` for the harness, and **`binary-editor/AGENTS.md`** for the project's UI conventions and the review brief - it indexes the co-located writer-facing rules (`client/src/binary-editor/webview/AGENTS.md` for the render layer, `binary/src/AGENTS.md` for the layout schema), which auto-load when you edit those dirs. Review rendered screenshots against the guidelines.
- **To check what the LSP server actually returns, use `pnpm lsp-probe` before booting an editor.** `pnpm lsp-probe <hover|completion|definition|references|symbols|signature|inlay|rename> <file> <line> <col>` (1-based) spawns the built `server/out/server.js` over stdio and prints the real response - the same request path an editor exercises, in one command. Reach for it whenever the question is "what does the server return for this request at this position" (verifying a provider change, diagnosing a wrong hover/completion) instead of writing a throwaway test or driving `dev:web`. Needs a built server (`pnpm build:dev`). Cross-file results (references, definition into another file) are complete: the probe waits for the server to report the background workspace scan finished before asking, and if that takes longer than `--scan-timeout` (default 20s) it prints the partial answer with a warning on stderr rather than silently. It does not replace the live editor drive for UI/webview behavior - see the `dev:web` bullet below.
- **To check one SSL construct against the reference compiler, use `pnpm ssl-diff` - not the corpus sweep.** `pnpm ssl-diff <file.ssl>` or `pnpm ssl-diff -e '<source>'` (add `-O1`/`-O2`, or `--keep`) compiles the source both ways and byte-compares them in about a second, reporting a one-sided refusal as a difference too. The corpus sweep (`compilers/ssl/vitest.integration.config.ts`, a few minutes against committed oracle digests; `pnpm ssl-oracles` regenerates those from the live compiler in ~16 min) answers a different question - "did anything regress across 1500 real scripts" - and belongs at close-out. Full guidance for changing that compiler, including where a finding graduates to and why the corpus cannot tell you what the language is, lives in **`compilers/ssl/AGENTS.md`** (auto-loads when you edit that package).
- **To run the whole extension in a real VS Code instance, use `pnpm dev:web`.** It starts [code-server](https://github.com/coder/code-server) (VS Code in a browser) with this repo loaded as an unpacked extension, so the LSP server and binary custom editor actually run - the screenshot harness above only renders the webview in isolation. Default serves plain HTTP on `0.0.0.0:8080` (override with `CODE_SERVER_PORT`/`CODE_SERVER_HOST`); it bootstraps a pinned code-server into the gitignored `.dev/` on first run, then builds via `build:dev`. The command runs a long-lived server in the foreground - background it (or run it as a separate task) if you need the shell, bind to the port your environment exposes, and confirm it is up before reporting a URL. The binary editor is a webview, so the browser must reach it over a secure context (`http://localhost` via a port-forward, or a trusted cert) or the editor renders blank. Full details and configuration: **`scripts/dev-web.md`**.
- **Use `pnpm` exclusively. Never use `npx`.** This is a hard requirement. Every time you reach for `npx`, `npm`, or any npm-series command, stop and use `pnpm exec` instead. Example: `pnpm exec playwright` not `npx playwright`. This applies to all contexts including one-off commands, scripts, subagents, and delegated tasks. If pnpm is not available in a context, install it first or use the workspace package.json scripts.
- **Milestone close-out commands (scope to what you touched).** `scripts/test-scoped.sh [paths...]` maps changed paths (default: uncommitted git changes) to the affected suites and runs them; `--dry-run` prints the plan. Manually: binary changes -> `pnpm exec vitest run --config binary/vitest.config.ts`; webview/Svelte changes -> the client tests plus the binary-editor render harness. All vitest configs and suites run from any cwd - includes and fixture paths are anchored to their own file, keep it that way. Three tiers, cheapest first: `test-scoped.sh` while iterating, `pnpm test` (~3 min - every category, shallow) before a handoff or commit, and `pnpm build:all` + `pnpm test:all` (~14 min) for close-out, or for changes that span subsystems or touch shared build infra, grammars, transpilers, or the server. `pnpm test` covers every category the gate does and differs only in depth, so a suite that vanishes rather than failing is the hazard to watch: the SSL corpus canary prints the sample size it drew, and `scripts/ensure-weidu.sh` (called by both test scripts, exported as `WEIDU_BIN`) downloads a pinned WeiDU rather than letting the grammar differential skip itself.
- **Editing a workflow shifts `zizmor.yml`'s line-anchored ignores.** Each accepted finding is recorded as `<workflow>:<line>`, so inserting or deleting a line above one silently un-ignores it and `pnpm lint:workflows` fails - reporting the OLD finding (e.g. the SLSA `unpinned-uses`, which is deliberate and must stay tag-pinned), never the stale anchor that caused it. Re-point the numbers in the same change that moved the lines, and read a workflow-lint failure as "did I shift an anchor?" before treating it as a new security finding.
- **Rebuild TextMate grammars after editing YAML sources.** After modifying any `syntaxes/*.tmLanguage.yml` file, run `scripts/syntaxes-to-json.sh` to regenerate the compiled JSON before testing or committing. **Never hand-edit `syntaxes/*.tmLanguage.json` files** - they are fully generated from the YAML sources and any manual edits will be overwritten.
- **Do not hand-edit auto-generated TextMate stanzas.** Several stanzas across `syntaxes/*.tmLanguage.yml` are generated from `server/data/*.yml` via `generate-data.sh` - see `docs/data-pipeline.md` for the full list. Edit the YAML data source, then regenerate. Auto-generated stanzas are marked with a `# Auto-generated` comment. Because both the `.yml` sources (generator-maintained stanzas) and `.json` outputs (emitted by `yaml2json.ts`) are generator-owned, `syntaxes/*.tmLanguage.{yml,json}` are excluded from `oxfmt` via `.oxfmtrc.json`; running `oxfmt` on them would be undone on the next regen.
- **oxfmt formatting and generated-file exclusions.** `oxfmt` formats YAML/Markdown at 2-space and JSON/TS at 4 (`overrides` in `.oxfmtrc.json`). Generated artifacts are excluded from `oxfmt` so their canonical format stays the generator's output; the authoritative exclusion list is `.oxfmtrc.json` `ignorePatterns`. Generated source/data files carry an `Auto-generated ... Do not hand-edit` first-line marker. Two guards keep this honest: `scripts/utils/test/oxfmt-generated-exclusions.test.ts` (every marked file stays excluded - no drift) and `scripts/utils/test/data-json-well-formed.test.ts` (every committed data JSON parses, including the oxfmt-excluded ones). `oxlint` deliberately does NOT mirror these exclusions (`.oxlintrc.json` `ignorePatterns` is a much smaller set): generated files stay linted (a linter catches real generator bugs; a formatter only fights the generator) - the asymmetry is intentional, do not "align" the two ignore lists.
- **Sort YAML data files with the existing script.** To sort `server/data/*.yml` files, use `pnpm exec tsx scripts/utils/src/sort-yaml-stanzas-and-items.ts <file>`. Do not write custom sorting code. See `scripts/README.md` for all available script utilities.

## Project Overview

VSCode extension providing IDE features for niche scripting languages used in classic RPG modding (Fallout 1/2 and Infinity Engine games like Baldur's Gate).

**Languages:**

- **Fallout SSL** - Scripting language for Fallout 1/2 game scripts
- **WeiDU formats** - Modding toolchain for Infinity Engine games: `.baf` (scripts), `.d` (dialogs), `.tp2` (mod installers), `.tra` (translations), `.2da` (tables)
- **SCS SSL/SLB** - Sword Coast Stratagems scripting (Infinity Engine AI mods)
- **Transpilers** - TypeScript-like languages compiling to the above: TBAF->BAF, TD->D. TSSL is a compiler: TypeScript straight to Fallout INT bytecode, with SSL as an optional output

**Features:** Completion, hover, go-to-definition, find references, rename, document symbols, formatting, inlay hints (translation string previews from .msg/.tra), diagnostics (via sslc/weidu), JSDoc, signature help, dialog editor (webview), binary file editor (Fallout `.pro` / `.map`, Infinity Engine `.itm` / `.spl` / `.eff` / `.cre`), animation editor (Fallout `.frm`, IE `.bam`).

**How it works:**

1. Client starts the LSP server over IPC
2. Server initializes tree-sitter parsers via `ParserManager` (sequentially, due to WASM constraints)
3. Server registers language providers in a `ProviderRegistry`; each loads static data from YAML/JSON
4. On LSP requests, the registry routes to the correct provider by `languageId`
5. Providers combine static YAML data with dynamic tree-sitter AST analysis to produce results
6. Transpilers use a shared pipeline (`createTranspiler`) + `ts-morph` to parse TypeScript ASTs and emit target language code

## Repository Structure

```
client/                  # VSCode extension client (LSP client, webviews, binary editor)
server/                  # LSP server (providers, symbol system, compilation, dialog bridges)
  data/                  # YAML engine definitions (functions, actions, triggers)
shared/                  # Shared pure TypeScript helpers used by runtime and build-time code
grammars/                # Tree-sitter grammars (6 dirs: 4 LSP + 2 parsed for diagnostics/highlighting only: msg, tra)
binary/                  # @bgforge/binary package: library + fgbin CLI (Fallout PRO/MAP, Infinity Engine ITM/SPL/EFF/CRE parser)
binary-editor/           # @bgforge/binary-editor package: declarative layout layer (parsed records -> editor blocks), consumed by the client webview
format/                  # @bgforge/format package: library + fgfmt CLI (Fallout/WeiDU formatters)
image/                   # @bgforge/image package: animation library (Fallout FRM, IE BAM, PNG/APNG conversions), backs the client's animation editor
compilers/ssl/           # @bgforge/ssl package (private): Fallout SSL -> INT compiler + the `ssl` CLI, backs the server's "built-in" compiler
compilers/tssl/          # @bgforge/tssl package: TypeScript -> INT compiler + the `tssl` CLI. Emits bytecode by default; `--transpile` also writes the readable SSL
plugins/                 # TypeScript Language Service Plugins: tssl-plugin/, td-plugin/
editors/                 # Hand-written editor syntax inputs, merged with generated output by build-editors.sh
syntaxes/                # TextMate grammars (YAML source + JSON compiled)
themes/                  # Color themes (bgforge-monokai) + icon theme
language-configurations/ # VSCode language config files (brackets, comments, indentation)
snippets/                # Code snippets: fallout-ssl.json, weidu-baf.json, weidu-tp2.json
scripts/                 # Build, test, data generation scripts
actions/                 # Reusable composite GitHub Actions published from this repo: binary/ (refresh/check JSON snapshots for any format @bgforge/binary supports), format/ (fgfmt in-place formatting), transpile/ (fgtp source->output regeneration), tssl/ (.tssl -> Fallout INT bytecode). Each runs the matching CLI over the event's changed files and commits the result back (or verifies it with check: true). _shared/ holds the scripts common to all four
transpilers/             # Transpiler implementations + user documentation (TBAF and TD; TSSL is a compiler and lives under compilers/)
  common/                # Shared transpiler utilities (workspace-internal, not published). The name predates the repo-wide "shared" term for this role; renaming would churn ~40 files plus the @bgforge/transpiler-common package name for no functional gain
  tbaf/                  # @bgforge/tbaf package: TypeScript to WeiDU BAF
  td/                    # @bgforge/td package: TypeScript to WeiDU D
docs/                    # User docs, editor setup guides, architecture, changelog
external/                # Third-party mod sources (test fixtures, not project code)
```

**Root config files:** `knip.ts`, `.oxlintrc.json`, `.editorconfig`, `pnpm-workspace.yaml`

## Commands

```bash
pnpm build             # Default repo-wide build: client (+ webviews + TS plugins) + server + test bundles + transpile + format + binary + ssl CLIs
pnpm build:all         # Full build: build + grammars + editor bundles + transpile
pnpm build:dev         # Minimal build for F5 development (skips CLIs, linting, tests)
pnpm build:grammar     # Build tree-sitter grammars to WASM
pnpm build:transpile   # Build transpile library + CLI (tsdown, produces out/index.js + out/cli.js)
pnpm build:format      # Build format library + CLI (tsdown, produces out/index.js + out/cli.js)
pnpm build:ssl         # Build SSL compiler library + ssl CLI (tsdown, produces out/index.js + out/cli.js)
pnpm test              # Dev-loop suite: typecheck, lint, knip, unit tests (no coverage), samples, CLI, smoke, grammars, server integration, SSL corpus canary
pnpm test:all          # Close-out gate: the same categories at full depth - test + coverage thresholds + the external-corpus format sweep + the full SSL corpus sweeps + transpile-external. For cross-subsystem / shared-infra close-out; scope to the affected package otherwise (see Important Rules).
pnpm test:grammars     # Grammar tests (generate, lint, corpus, highlight, parse, format)
pnpm test:cli          # CLI mode tests (check/save/stdout exit codes, diff output)
pnpm test:e2e          # E2E tests (requires build and host Electron libraries)
pnpm bench             # Run perf benches (server/test/perf/, compilers/tssl/test/perf/) - manual/local only, not in CI
pnpm package           # Create VSIX
```

Watch: `pnpm watch:client`, `pnpm watch:server`

### Running Individual Tests

```bash
# Server unit tests (vitest)
cd server && pnpm test:unit                           # All unit tests
cd server && pnpm exec vitest run test/common.test.ts # Single file

# Server integration tests (requires external repos: pnpm test:external)
cd server && pnpm test:integration                    # All integration tests

# Server full test suite (typecheck + lint + unit + td/tbaf samples)
cd server && pnpm test

# Client tests (typecheck + lint)
cd client && pnpm test

# Single grammar tests (auto-builds format CLI if missing)
cd grammars/weidu-tp2 && pnpm test   # or any grammars/*/

```

**Testing against real external files.** The `external/` mod trees are gitignored but REPRODUCIBLE - `pnpm test:external` (via `scripts/reset-external.sh` + `scripts/external-repos-lib.sh`) clones/checks them out at pinned refs. So real-corpus coverage belongs in a committed test, not a throwaway: tests that exercise real external files live under `server/test/integration/**` (run by `pnpm test:integration`, config `server/vitest.integration.config.ts`), using `test/integration/test-helpers.ts` (`FALLOUT_FIXTURES` = `external/fallout`, `IE_FIXTURES` = `external/infinity-engine`, `loadFixture`/`loadFixtures`). Gate a corpus sweep with `describe.skipIf(files.length === 0)` so it skips cleanly when the corpus is not checked out. Before placing any real-file test, read a sibling there (`integration/weidu-d.test.ts`, `integration/fallout-ssl.test.ts`) for the fixture/init conventions. Do NOT commit copies of gitignored `external/` files as fixtures, and do NOT hand-run a one-off script where this suite is the home.

## Publishing & Release

Releases are tag-driven via GitHub Actions. `docs/releasing.md` is the canonical reference: the tag scheme (which tag form triggers which workflow), and the per-stream release procedures for the extension, the three libraries, and the reusable Action - including the root/`server` version-identity invariant. The server and VSIX bundle their `@bgforge/*` libraries rather than depending on them at runtime, so the extension and the libraries release in any order. Consult it before cutting any release. See `docs/architecture.md` for packaging mechanics.

**Pinned dependency constraints:** Per-dependency pin rationale (the LSP triplet, `ts-morph`/`typescript` lockstep,
`@types/node` LTS policy, `ini`, `playwright`, `bits-ui`, `esbuild-wasm`, `tree-sitter-cli`, the `sslc` tarball
integrity field) lives in `docs/dependencies.md` - consult it before any dependency bump.

## Architecture

LSP-based extension with provider-registry pattern. Monorepo with separate `client/` and `server/` packages. Build uses esbuild (not tsc) for all bundles.

**Providers** (`server/src/*/provider.ts`): fallout-ssl, fallout-worldmap, weidu-baf, weidu-d, weidu-log, weidu-tp2

**Transpilers** (`transpilers/*/src/`): tbaf, td + shared `transpilers/common/`. TSSL is a compiler (`compilers/tssl`), not a transpiler: it emits INT bytecode by default and the SSL text on request.

For detailed architecture, see:

- `docs/architecture.md` - system overview, build pipeline, client, CLIs, grammars, packaging
- `server/INTERNALS.md` - server internals: provider registry, symbol system, data flow, tree-sitter, feature implementations, design decisions
- `binary/INTERNALS.md` - binary library internals: spec system, primitives, derivation, orchestrator/spec boundary, format adapters, adding a new format

### Tree-Sitter Type Generation

The `SyntaxType` enum is generated from each grammar using `@asgerf/dts-tree-sitter`, then split into a
runtime `syntax-type.ts` (the enum) and `tree-sitter.d.ts` (the node-type declarations, which import the enum
as a type). An enum living only in a `.d.ts` is erased at runtime by Rolldown/tsdown; the runtime split lets
any bundler resolve it.

The runtime enum's canonical home is `shared/syntax-types/<grammar>.ts` so `@bgforge/format` can consume it
without importing `server/` internals (that would form a `format` <-> `server` source cycle). `server/src/<grammar>/syntax-type.ts`
is a one-line re-export shim of that shared file, so server code keeps importing the enum from `./syntax-type`
unchanged and the generated `tree-sitter.d.ts` resolves its `import type { SyntaxType }` through the shim.
Server code imports `./syntax-type`; `@bgforge/format` imports `../../../shared/syntax-types/<grammar>`.

```bash
cd grammars/fallout-ssl && pnpm run generate:types
# Runs dts-tree-sitter, splits the enum into src/syntax-type.ts via scripts/split-syntax-type.mjs,
# then copies tree-sitter.d.ts to server/src/fallout-ssl/ and syntax-type.ts to shared/syntax-types/fallout-ssl.ts
```

All four LSP grammars have this script. It runs automatically as part of `pnpm build:grammar`. After modifying a grammar's `grammar.js`, rebuild with `pnpm build:grammar` to regenerate WASM files and type definitions.

## Feature Status

See `server/INTERNALS.md` for the full feature matrix and cross-language feature status.

**N/A rationale:**

- **BAF Symbols/Definition/Rename**: BAF files are flat sequences of IF/THEN/RESPONSE blocks with no named procedures, functions, or reusable constructs.
- **BAF JSDoc**: No user-defined constructs to document.
- **Worldmap**: Simple key-value config file, no programming constructs.
- **TP2 Signature Help**: TP2 function calls use named keyword parameters (`INT_VAR`/`STR_VAR`/`RET` blocks), not positional arguments. Signature help is designed for positional parameter tracking and does not apply. Parameter documentation is surfaced via hover and completion instead.
- **TP2 Parameter Inlay Hints**: Not needed. Parameters are already named explicitly in the source (`INT_VAR foo = 0`) and documented via hover and completion. There is nothing implicit to annotate.

## Documentation Index

| Area                    | Key Files                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Architecture            | `docs/architecture.md`, `server/INTERNALS.md`, `binary/INTERNALS.md`                                                       |
| Contributing            | `CONTRIBUTING.md`                                                                                                          |
| Settings                | `docs/settings.md`                                                                                                         |
| Changelog               | `docs/changelog.md`                                                                                                        |
| User docs (misc)        | `docs/README.md`, `docs/file_associations.md`, `docs/theme.md`, `docs/icon-theme.md`, `docs/lsp-api.md`                    |
| Editor setup            | `docs/editors/` (`README.md` + 9 editor guides: neovim, emacs, helix, zed, kate, sublime, jetbrains, geany, notepadpp)     |
| TS plugins              | `docs/editors/typescript-plugins.md` (user setup), `plugins/td-plugin/README.md`, `plugins/tssl-plugin/README.md` (source) |
| Transpile library       | `transpilers/README.md`                                                                                                    |
| Transpiler guides       | `transpilers/{tbaf,td}/docs/` (each has README + writing guide)                                                            |
| Compilers overview      | `compilers/README.md` (what each compiler is; the differentials live in `compilers/ssl/AGENTS.md`)                         |
| TSSL compiler + CLI     | `compilers/tssl/README.md` and `compilers/tssl/docs/` (CLI ships as `tssl` bin in `@bgforge/tssl`)                         |
| TSSL <-> folib contract | `compilers/tssl/AGENTS.md` (what each owes the other, and why the compiler reads folib's source)                           |
| Transpile CLI           | see `transpilers/README.md` (CLI ships as `fgtp` bin in `@bgforge/transpile`)                                              |
| Server npm package      | `server/README.md`                                                                                                         |
| Image library           | `image/README.md`                                                                                                          |
| SSL compiler + CLI      | `compilers/ssl/README.md` (CLI ships as `ssl` bin in the private `@bgforge/ssl`)                                           |
| Data files              | `server/data/README.md`                                                                                                    |
| Data pipeline           | `docs/data-pipeline.md`                                                                                                    |
| Grammars                | `grammars/README.md` + per-grammar `README.md` and `formatter.md`                                                          |
| Syntaxes                | `syntaxes/README.md`                                                                                                       |
| Themes (source)         | `themes/README.md`                                                                                                         |
| Language configurations | `language-configurations/README.md`                                                                                        |
| Build scripts           | `scripts/README.md`                                                                                                        |
| Dev (VS Code web)       | `scripts/dev-web.md`                                                                                                       |
| Reusable GH Actions     | `actions/README.md` (shared contract) + `actions/{binary,format,transpile,tssl}/README.md`                                 |
| Packaging               | `docs/ignore-files.md`                                                                                                     |
| Releasing               | `docs/releasing.md`                                                                                                        |
| Supply chain            | `docs/supply-chain.md` (SBOM/SLSA, CodeQL + Scorecard, and the two deliberate non-additions)                               |
| Roadmap                 | `docs/todo.md`                                                                                                             |
| Binary editor UI        | `binary-editor/AGENTS.md`                                                                                                  |
| Dependencies            | `docs/dependencies.md`                                                                                                     |
