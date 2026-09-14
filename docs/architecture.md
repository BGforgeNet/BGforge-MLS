# Architecture

See also: [development.md](development.md) | [server/INTERNALS.md](../server/INTERNALS.md) | [scripts/README.md](../scripts/README.md)

High-level shape of the BGforge MLS extension: which pieces exist, how they connect, and the decisions behind that.
Module-level detail lives beside the code - in each module's header comment and in the package docs this page
links - so this page names the layer and points there rather than restating it.

## Table of Contents

- [System Overview](#system-overview)
- [Repository Layout](#repository-layout)
- [Build System](#build-system)
  - [Key Build Constraints](#key-build-constraints)
  - [TypeScript configuration](#typescript-configuration)
- [Client Architecture](#client-architecture)
  - [Extension Activation](#extension-activation)
  - [TypeScript Language Service Plugins](#typescript-language-service-plugins)
  - [Webview Panels](#webview-panels)
- [Server Architecture](#server-architecture)
  - [Transpilers](#transpilers)
- [CLI Tools](#cli-tools)
- [Grammar Architecture](#grammar-architecture)
- [Data Pipeline](#data-pipeline)
- [Test Architecture](#test-architecture)
- [Extension Packaging](#extension-packaging)
- [Latency Budgets](#latency-budgets)
- [Key Design Decisions](#key-design-decisions)
- [Deliberate Non-Consolidations](#deliberate-non-consolidations)

## System Overview

```
+-------------------+       IPC        +-------------------+
|   VSCode Client   | <--------------> |    LSP Server     |
|  (extension.ts)   |                  |   (server.ts)     |
+-------------------+                  +-------------------+
        |                                      |
        |  TS Language Service                 +--> ProviderRegistry --> per-language providers
        |  (tsserver process)                  |
        v                                      +--> worker threads (ts-morph work, compilers)
+-------------------+
| bgforge-tssl-     |
|   plugin          |
| bgforge-td-       |
|   plugin          |
+-------------------+

+-------------------+
|   CLI Tools       |   Standalone; same library packages as the server, no VSCode dependency
|   fgfmt fgtp      |
|   fgbin ssl tssl  |
+-------------------+
```

Three runtime processes:

1. **VSCode Client** - extension activation, commands, custom editors and webview panels
2. **LSP Server** - language features (completion, hover, definition, format, etc.)
3. **tsserver** - TypeScript Language Service plugins for `.tssl` and `.td` files

Synchronous CPU-heavy work runs on worker threads rather than on either main thread: the server's ts-morph work
(transpiling and dialog parsing) and compilers, the binary editor's parsing, and the gallery's thumbnails. The
workers are started from `server/src/worker/`, `client/src/binary-editor/` and `client/src/gallery/`.

## Repository Layout

Top-level directories. Where a package has its own README or `INTERNALS.md`, that describes its modules;
`client/src/` and `shared/`, the two largest trees without one, are mapped below the table.

| Directory                            | Contents                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/`                            | VSCode extension client: activation, custom editors and panels (`client/src/<feature>/`, each with a `webview/` where it has one), E2E tests |
| `server/`                            | LSP server - see [server/INTERNALS.md](../server/INTERNALS.md); `server/data/` holds the YAML game-engine data                               |
| `binary/`                            | `@bgforge/binary`: binary format parsers + `fgbin` CLI - see [binary/INTERNALS.md](../binary/INTERNALS.md)                                   |
| `binary-editor/`                     | `@bgforge/binary-editor`: declarative layout layer between parsed records and the editor webview                                             |
| `format/`                            | `@bgforge/format`: formatters + `fgfmt` CLI                                                                                                  |
| `image/`                             | `@bgforge/image`: FRM/BAM codecs, palette and true-colour conversion, PNG import/export                                                      |
| `animation/`                         | `@bgforge/animation`: IE animation-set resolution, neutral model, conversion                                                                 |
| `compilers/`                         | Compilers, one per source language (`ssl`, `tssl`, `bcs`) - see [compilers/README.md](../compilers/README.md)                                |
| `transpilers/`                       | TypeScript-to-source transpilers (`tbaf`, `td`, shared `common`) and the `@bgforge/transpile` library + `fgtp` CLI                           |
| `shared/`                            | Pure TypeScript shared across workspaces: CLI utilities, parser management, dialog model, syntax-type enums                                  |
| `plugins/`                           | TypeScript Language Service plugins (`tssl-plugin`, `td-plugin`)                                                                             |
| `grammars/`                          | Tree-sitter grammars - see [grammars/README.md](../grammars/README.md)                                                                       |
| `syntaxes/`                          | TextMate grammars (YAML source -> JSON)                                                                                                      |
| `editors/`                           | Hand-written editor syntax inputs, merged with generated output by `build-editors.sh`                                                        |
| `language-configurations/`           | VSCode language settings (brackets, comments, indent)                                                                                        |
| `themes/`, `snippets/`, `resources/` | Colour and icon themes, code snippets, extension icon                                                                                        |
| `scripts/`                           | Build, test and data-generation scripts - see [scripts/README.md](../scripts/README.md)                                                      |
| `actions/`                           | Reusable composite GitHub Actions - see [actions/README.md](../actions/README.md)                                                            |
| `external/`                          | Real game and mod files for tests (gitignored, restored by `pnpm test:external`)                                                             |

**`client/src/`** - one directory per feature, plus helpers shared across them:

- `dialog-editor/`, `binary-editor/`, `image-editor/`, `gallery/` - the custom editors and panels, each with its
  Svelte `webview/`
- `ie-resources/` - the IE game resource viewer: the sidebar tree over an installed game, and the
  `bgforge-ie-resource:` FileSystemProvider that lets the editors open and save resources out of `chitin.key`/BIF
  and `override/`
- `script-view/` - the one FileSystemProvider that serves a compiled script as editable source, rendering on read
  and compiling on write; `bcs-editor/` (Infinity Engine `.bcs` as BAF) and `int-editor/` (Fallout `.int` as SSL)
  hold only what differs per format
- `webview-ui/` - Svelte components and stylesheets shared by the webviews
- `test/` - E2E tests (mocha in a real VS Code)
- top level: `extension.ts` (activation), `logging.ts` (the output channel and `conlog`), `webview-assets.ts`,
  `webview-html.ts` and `webview-error.ts` (panel HTML, assets and error surfacing on the host side),
  `webview-utils.ts` (in-webview helpers), `hot-exit-backup.ts` (backup policy shared by the custom editors)

**`shared/`** - pure TypeScript used by both runtime and build-time code:

- `cli/` - `cli-utils.ts`, the argument parsing, file discovery and diff reporting the repo-convention CLIs share
- `parsers/` - the tree-sitter parser factory and manager, one facade per language, and the grammar WASMs
- `syntax-types/` - the runtime `SyntaxType` enums (see [Key Build Constraints](#key-build-constraints))
- top level: the dialog model and its per-language edit and serialize modules (`dialog-*.ts`), and small shared
  helpers such as `languages.ts` and `spawn-timeout.ts`

`transpilers/common/` predates the repo-wide use of "shared" for this role (`shared/` now holds the helpers used by
both runtime and build-time code). The name stays: renaming it would churn dozens of files plus the
`@bgforge/transpiler-common` package name for no functional gain.

## Build System

The monorepo uses **pnpm workspaces**. Two bundlers, split by what is being built:

- **esbuild** builds the extension itself: the client (`scripts/build-base-client.sh`), the server and its workers
  (`scripts/build-base-server.sh`), the TS plugins (`scripts/build-ts-plugin.sh`), the webviews
  (`scripts/build-webviews.mjs`) and the E2E test bundle (`scripts/build-test.sh`).
- **tsdown** builds the library packages that have an `out/` artifact - each one with a `tsdown.config.ts`, which is
  the record of its entries and output. The workspace-internal packages without one (`binary-editor`, `bcs`,
  `transpilers/common`, `tbaf`, `td`) are consumed from source by the bundles that import them, and so, in the
  extension build, are `image` and `animation`, which the client reaches through tsconfig `paths`.

`pnpm build` (`scripts/build-packages.sh`, which names each job) builds the extension bundles and the CLI packages
in parallel; `image` and `animation` build only through their own `build` script. `pnpm build:all` adds the
grammars before it and the external-editor bundles after it; `pnpm build:dev` is the minimal build for F5
development. The exact composition is the `build*` scripts in `package.json`.

### Key Build Constraints

1. **WASM URL resolution**: web-tree-sitter uses `import.meta.url` for WASM loading, which esbuild's CJS output
   shims as an empty object. The build scripts use `--banner:js` to define a `__imu` variable holding the correct
   file URL, and `--define:import.meta.url=__imu` to replace references - which survives `--minify`, where a
   textual rewrite would not.
2. **TS plugins**: must be standalone CJS bundles in `node_modules/` directories. tsserver loads them by package
   name from `typescriptServerPlugins` in package.json.
3. **Externalized .d.ts imports**: transpiler libraries (ielib, folib) use `.d.ts` for engine declarations; the
   bundler externalizes these and they pass through as bare identifiers. Libraries must use named re-exports, not
   `export *`.
4. **`SyntaxType` is a runtime module**: an enum declared only in a `.d.ts` has no runtime representation, and
   Rolldown (under tsdown) erases it. The type-generation pipeline therefore splits each grammar's enum into a
   runtime module (`scripts/split-syntax-type.mjs`) whose canonical home is `shared/syntax-types/<grammar>.ts`;
   `server/src/<grammar>/syntax-type.ts` re-exports it, so `@bgforge/format` reaches the enum without importing
   `server/`.
5. **Server runtime dependencies**: the server bundles inline everything except `vscode` and `esbuild-wasm`, so
   `@bgforge/mls-server` declares only `esbuild-wasm` as a runtime dependency (plus the optional
   `sslc-emscripten-noderawfs` compiler). The record of what is bundled is the release CycloneDX SBOM, not the
   manifest; which bundle carries what is commented in `scripts/build-base-server.sh`.

### TypeScript configuration

esbuild and tsdown emit all production code; `tsc` is used for type-checking only (`noEmit: true`).
`tsconfig.base.json` reflects this with `module: ESNext`, `moduleResolution: bundler`,
`verbatimModuleSyntax: true`, and `noEmit: true`. Two exceptions override the base:
scripts run via tsx/Node and need `module: NodeNext`; TS Language Service plugins use `export = init` (tsserver
loads them as CommonJS), so they set `verbatimModuleSyntax: false` and a `module` that still permits `export =`

- the reason for the exact value is commented in each plugin's `tsconfig.json`.

## Client Architecture

### Extension Activation

What activates the extension is `activationEvents` in package.json. `activate()` in `client/src/extension.ts`
registers the editors and panels and starts the language client. The order constraint that shapes the rest: the IE
game resource viewer registers first, because it owns the game session the binary editor, the animation editor and
the gallery resolve names and resources through.

**VSCode engine floor:** `engines.vscode` in `package.json` (mirrored by `client/package.json` and `@types/vscode`)
follows the floor `vscode-languageclient` itself declares. Raise it only when that dependency, or a feature needing
a later VS Code API, requires it.

### TypeScript Language Service Plugins

Plugins intercept tsserver calls for transpiler files. They run inside the tsserver
process, not the extension host.

- **TSSL Plugin** - suppresses TS6133 for engine procedures, adds hover docs. See [plugins/tssl-plugin/README.md](../plugins/tssl-plugin/README.md).
- **TD Plugin** - injects `td-runtime.d.ts`, filters completions per file type. See [plugins/td-plugin/README.md](../plugins/td-plugin/README.md).

### Webview Panels

Each custom editor or panel with a UI lives in `client/src/<feature>/`: a host-side module that owns the VS Code
boundary, and a `webview/` Svelte app built by `scripts/build-webviews.mjs`. Shared webview components and styles
are in `client/src/webview-ui/`.

The Dialog Editor is a `CustomTextEditorProvider` (viewType `bgforge.dialogEditor`), not a standalone panel: it edits
the underlying `.d`/`.ssl`/`.td`/`.tssl` source, round-tripping changes through the server. Compiled `.dlg` files open
in the same webview under their own viewType. For the binary library - spec system, format adapters, JSON snapshots,
declarative layout - see [binary/INTERNALS.md](../binary/INTERNALS.md); for the binary editor's UI conventions,
[binary-editor-ui.md](binary-editor-ui.md).

#### Webview CSP: styles need `cspSource`, not a bare nonce

Every webview locks its inline `<script>` bundle to a per-load CSP nonce (`script-src 'nonce-...'`). Styles are
different: a webview's `style-src` **must include `{{cspSource}}`**. VS Code wraps the webview in its own CSP layer
and only honours `style-src` sources it can attribute to the webview origin (`cspSource`); a `style-src 'nonce-...'`
with no `cspSource` is honoured by raw Chromium - so it passes any headless or standalone render - but is silently
dropped by the wrapped VS Code webview. The symptom is a fully unstyled panel (default user-agent buttons, no theme
colors) while the nonce'd script still runs, so the editor looks live but flat. So stylesheets load as
`webview.asWebviewUri()` `<link>` elements, with each CSS directory in the panel's `localResourceRoots`.

The dialog editor is the one webview whose policy is wider, and each widening is commented in
`client/src/dialog-editor/dialog-webview-html.ts`: `'unsafe-inline'` styles because Svelte Flow positions nodes
with runtime inline `transform` styles, `'wasm-unsafe-eval'` for the tree-sitter tokenizer, and a `blob:` worker for
the graph layout. The CSP shapes are pinned by `client/test/webview-csp.test.ts`, and the dialog editor's by
`client/test/dialog-panel-html.test.ts`.

## Server Architecture

See [server/INTERNALS.md](../server/INTERNALS.md) for the provider registry and request routing, the symbol system,
the include graph, data flow, tree-sitter integration, the translation service, the feature matrix, and adding a
new provider.

Two behaviour points are easy to miss:

- Provider indexing is registry-driven via `indexExtensions`, not provider-specific startup scans.
- VS Code workspace-symbol search is scoped to the active document language for `fallout-ssl`, `weidu-d`, and `weidu-tp2`, so Ctrl+T does not mix symbols across languages.

### Transpilers

TBAF and TD are TypeScript-to-source transpilers sharing one pipeline; TSSL, which emits INT bytecode, is a
compiler under `compilers/` but reuses the same orchestration.

```
Source (.tbaf/.td)
  |
  +-> Extract @tra tag (esbuild strips comments)
  +-> Bundle imports (esbuild, shared bundler)
  +-> Parse AST (ts-morph)
  +-> Transform to IR (language-specific)
  +-> Emit target language text
  +-> Write output file
  +-> Optional: chain native compilation
```

The internal packages under `transpilers/` stay private; the `@bgforge/transpile` library at the `transpilers/`
root bundles them into a single ESM artifact via tsdown, and TSSL ships separately as `@bgforge/tssl`. Internal
consumers (the LSP server, the TS plugins) import the per-language packages directly. Among the library's runtime
dependencies, `esbuild-wasm` is the one that must stay external - it cannot be inlined because it detects bundling
at load time.

- **Shared pipeline** (`transpilers/common/transpiler-pipeline.ts`): `createTranspiler()` handles extension
  validation, @tra tag extraction, file I/O and structured compile events, and never writes to stdout - each host
  decides how to surface the events. TBAF, TD and TSSL all use it.
- **Shared bundler** (`transpilers/common/bundle.ts`): used by TBAF and TD. TSSL does not bundle: it resolves its
  imports through the TypeScript checker (`compilers/tssl/src/program-model.ts`), so float literals, JSDoc and
  identifiers reach the output as written.
- **Per-language IR**: TBAF has a structured IR with condition algebra (boolean to CNF for BAF OR groups); TD has
  the richest IR, with state machines, method-chain parsing and orphan detection. Each package's `src/` holds it.

The Dialog Editor's server-side parse (`parseDialog`, `server/src/dialog.ts`) lives in the server rather than a
transpiler package, because it depends on the tree-sitter parsers and LSP infrastructure.

## CLI Tools

Standalone command-line tools with no VSCode dependency. Each ships as a bin of the library package it belongs to,
and its README is the reference for usage and flags.

### Format CLI

`fgfmt`, in `@bgforge/format` - see [format/README.md](../format/README.md). Formats the parser-based languages
(SSL, BAF, D, TP2, via tree-sitter, respecting `.editorconfig`) and the string-based ones (TRA, MSG, 2DA,
scripts.lst); the library entry exposes the same formatters for custom build pipelines.

### Transpile CLI

`fgtp`, in `@bgforge/transpile` - see [transpilers/README.md](../transpilers/README.md). Transpiles `.tbaf` and `.td`;
`.tssl` is compiled by the separate `tssl` CLI.

### Binary CLI

`fgbin`, in `@bgforge/binary` - see [binary/README.md](../binary/README.md). Parses the supported binary formats to
canonical JSON snapshots and loads them back.

### SSL and TSSL CLIs

`ssl` and `tssl`, in `@bgforge/ssl` and `@bgforge/tssl` - see [compilers/README.md](../compilers/README.md). `ssl`
takes the reference `sslc` compiler's switches, so a build script written for it can call this instead, and its
output is held byte-identical to the reference by the corpus differentials in `compilers/ssl/test/integration/`.

### Shared CLI Infrastructure

`shared/cli/cli-utils.ts` provides argument parsing (`--save`, `--check`, `-r`, `-q`), file discovery, diff
reporting and the error-handling wrapper the repo-convention CLIs share.

## Grammar Architecture

### Tree-Sitter Grammars

Tree-sitter grammars compiled to WASM back the full LSP providers; the highlight-only ones are parsed for
parse-error diagnostics and provide highlighting for external editors. See
[grammars/README.md](../grammars/README.md) for the list, build commands, WASM rationale and type generation.

### TextMate Grammars

TextMate grammars (in `syntaxes/`) provide syntax highlighting: primary language grammars, tooltip grammars for
hover rendering, injection grammars for comments, strings and docstrings, and a webview tokenizer grammar consumed
directly by the dialog editor bundle rather than registered in `contributes.grammars`. Source is YAML, converted to
JSON at build time - see [syntaxes/README.md](../syntaxes/README.md).

## Data Pipeline

Game engine definitions flow from YAML sources to runtime. See [data-pipeline.md](data-pipeline.md) for the full
diagram and [server/data/README.md](../server/data/README.md) for the data files.

```
External Sources (IESDP, sfall, game files)
  |
  v
server/data/*.yml                       Version-controlled YAML
  |
  v
generate-data.sh                        Build-time conversion
  |
  v
server/out/*.json                       Bundled JSON (completion, hover, signature)
syntaxes/*.tmLanguage.yml               Updated highlight stanzas
  |
  v
core/static-loader.ts                   Runtime loading into Symbols index
```

## Test Architecture

See [scripts/README.md](../scripts/README.md) for all test commands. The layers, cheapest first:

- **Unit tests** - vitest, one project per package (the root `vitest.config.ts` names them all).
- **Integration tests** - grammar corpora, TD/TBAF sample transpilation, format comparison, CLI exit codes, and
  real-corpus suites over `external/` (for example `server/test/integration/`).
- **Render harnesses** - Playwright renders of individual webviews (`binary-editor/test/harness/`,
  `client/src/dialog-editor/test/harness/`).
- **E2E tests** - mocha in a real VS Code instance (`client/src/test/`).

### Coverage thresholds

Per-package vitest coverage thresholds reflect the slice of behaviour each package's unit tests are responsible
for, not the package's full execution surface. The authoritative values, and each package's exclusions, live in
that package's own `vitest.config.ts` (`coverage.thresholds`) - this doc does not restate them, so they cannot
drift. Some packages run intentionally low floors because other layers verify most of their behaviour; each one's
config says which layer. For example:

- **`@bgforge/format`**: the tree-sitter formatters are exercised end-to-end by the grammar corpora and by the
  `--check-idempotency` run in `scripts/test-external.sh`, so they are outside this gate's coverage scope.
- **`@bgforge/transpile`**: transpiler correctness is enforced mostly by the TD/TBAF fixture-driven integration
  suites; the vitest project covers the public API, shared helpers and targeted unit slices.
- **`@bgforge/tssl`**: its INT lowering is exercised mainly by `pnpm tssl-int-diff`, which byte-compares a whole
  real mod through both compilers and is a gate script rather than a test, so none of it reaches this instrument.

Stryker mutates only the files listed under `mutate` in `stryker.conf.json`, and its thresholds live in the same
file. The reasoning behind that scope is in the header of `.github/workflows/mutation.yml`.

Floors are round percentages set a point or two under the measured actuals, not the actuals themselves: a floor
pinned to the exact current figure goes red the first time a refactor shifts a ratio by a fraction, which trains
everyone to edit the number rather than read it. Ratchet upward only on deliberate coverage work - a widened unit
slice, a newly covered path - never as a reflex after an unrelated change moved the figure.

## Extension Packaging

`scripts/package.sh` builds the VSIX; its header describes the steps and why pnpm's layout needs them.
`.vscodeignore` uses a **blocklist** strategy (exclude dev files, keep runtime files by default), with a comment
beside each non-obvious exclusion, and [ignore-files.md](ignore-files.md) covers what ships.
`scripts/verify-vsix-runtime-deps.mjs` fails packaging when a declared runtime dependency, or one of its own
dependencies, cannot be resolved from inside the VSIX.

## Latency Budgets

The server wraps its LSP request handlers with `timeHandler` (`server/src/shared/time-handler.ts`) - not every one:
signature help and inlay hints, among others, are unwrapped, so `rg timeHandler server/src/handlers` is the list. When
a handler exceeds the threshold it logs a `[lsp-timing]` warning to the LSP console. The threshold is
`DEFAULT_THRESHOLD_MS = 50` ms and can be overridden at startup via the `BGFORGE_LSP_SLOW_MS` environment variable.

The threshold is a per-request budget, not an aggregate: a single request that takes longer than 50 ms triggers a
warning regardless of prior request history. Server startup is not wrapped: providers initialize sequentially by
design (see [Sequential Provider Initialization](#sequential-provider-initialization)), and that latency is
dominated by WASM load time, which is not actionable per request.

Revisit the threshold when a provider is added or a data source grows significantly, re-measuring the wrapped
handlers with the new language loaded.

## Key Design Decisions

### LSP + Provider Registry

All language features route through a single LSP server with a provider registry.
Providers implement an optional interface -- each language only implements what it
supports. This avoids separate servers per language while keeping providers decoupled.

### Tree-Sitter for Parsing, ts-morph for Transpiling

Tree-sitter (WASM) handles the niche scripting languages -- it's fast and grammar-driven. ts-morph handles
transpiler input (TypeScript subset) -- it provides a full TypeScript AST with type information.

### Pre-Computed Responses

LSP responses (completion items, hover markdown, signature help) are computed once at
parse/index time and stored in `IndexedSymbol`. Requests are O(1) lookups. This trades
memory for latency.

### Sequential Provider Initialization

web-tree-sitter uses a shared `TRANSFER_BUFFER` for JS/WASM communication. Concurrent
`Language.load()` calls corrupt parser state. Providers initialize sequentially.

### Standalone CLIs Share the Libraries

The CLIs are bins of the same library packages the server uses, so there is no second implementation of
formatting, transpiling, parsing or compiling. They are bundled with no VSCode dependency. The binary editor and
`fgbin` share one canonical JSON snapshot format ([binary/INTERNALS.md](../binary/INTERNALS.md)); the editor
parses MAP files strictly, while permissive boundary recovery (`--graceful-map`) is left to the CLI's corpus
workflows, where an editable tree matters less than getting through every file.

### TypeScript Plugins for Transpiler Languages

`.tssl` and `.td` files are valid TypeScript subsets. TS plugins intercept tsserver to
suppress false errors and inject engine documentation, giving users full TypeScript
tooling (type checking, refactoring, go-to-definition) alongside transpiler features.

### Dependency Stability Policy

Dependency bumps stay within the current major version. `pnpm update -r` is run
periodically to pick up minor and patch releases across the workspace; major bumps
(including 0.x -> 0.y where y > current, which npm treats as breaking) are deferred
until an explicit, motivated upgrade pass. This trades currency for stability: strict
mode, `verbatimModuleSyntax`, and the custom TS config make major-bump churn expensive,
and the extension's user surface is small enough that we gain little from being on the
absolute newest release of every library. Per-dependency pins and their reasons: [dependencies.md](dependencies.md).

### Scope-Aware Symbol Lookup

Symbol resolution respects language visibility rules automatically (SSL procedure scope,
TP2 first-assignment-wins, D dialog-scoped composite keys). Lookups never cross scope
boundaries, so features don't need to post-filter results.

### File-Level Index Granularity

Edits update only the changed file's entry in the symbol and references indexes, not the
whole workspace. Keeps incremental updates cheap on large mod repos.

### Fallthrough Resolution Pattern

A feature tries its resolution sources in a fixed order written at its handler - for hover: TLK strrefs,
translation references, the provider's AST-based answer, then the data index (see the Hover Request flow in
[server/INTERNALS.md](../server/INTERNALS.md)). The provider step returns the `HoverResult` discriminated union,
so "nothing to show here" and "not mine, keep looking" are different values rather than `null` and `undefined`.
This keeps language-specific precedence rules explicit at call sites rather than baked into shared helpers.

### Intentional Per-Language Implementations

Several features have separate implementations per provider that may look like duplication
but are intentionally language-specific. Shared infrastructure lives in `server/src/shared/`;
the per-language bodies encode genuinely different semantics:

| Feature                    | Why per-language                                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Definition finders         | Different scoping models (SSL procedures vs TP2 functions vs D state labels)                                                  |
| Document symbol extraction | Different construct types and scoping: SSL has explicit `variable` declarations, TP2 uses first-assignment-wins deduplication |
| Rename                     | SSL is workspace-wide via ReferencesIndex; TP2 is single-file with %var% handling                                             |
| Reference finders          | SSL has procedure scope shadows; TP2 has synthetic string nodes; D uses dialog-scoped composite keys                          |
| Call-site extractors       | SSL indexes all identifiers; TP2 indexes only function/macro names (case-sensitive); D uses dialog:label composite keys       |
| Folding block type sets    | Language-specific node types, passed as parameters to shared `getFoldingRanges()`                                             |
| Comment stripping          | `stripCommentsWeidu()` handles `~string~` delimiters; `stripCommentsFalloutSsl()` does not                                    |

### Tree-Sitter Error Recovery Defense

Tree-sitter error recovery can fabricate structurally valid nodes from broken input. In TP2, where assignment
needs no keyword (`foo = 5`), a half-typed keyword can come back as an assignment with a
phantom zero-width `=` operator, which would offer spurious variable completions. Two layers defend against it:
`isPhantomAssignment()` rejects assignments whose operator has zero width, and the word at the cursor is always
excluded from local completions. The first rests on observed tree-sitter behaviour rather than a documented
guarantee, which is why the second exists; the alternatives considered are in `isPhantomAssignment()`'s JSDoc.
Document symbols use a separate `node.hasError` guard that still recurses into children.

### URI Normalization (Gateway Pattern)

On Windows, VSCode and Node's `pathToFileURL()` produce different percent-encodings for the same file (e.g., `%21`
vs `!`, `%3A` vs `:`), so raw URI strings used as Map/Set keys mismatch silently when one file arrives by two
paths. The `NormalizedUri` branded type (`core/normalized-uri.ts`) canonicalizes `file://` URIs, `ProviderRegistry`
normalizes every URI at the gateway, and storage keyed by URI takes `NormalizedUri`, so an unnormalized key is a
type error.

### User-Facing Message Wrappers

All user-visible messages (`showInformationMessage`, `showWarningMessage`,
`showErrorMessage`) go through wrappers in `user-messages.ts` that auto-decode
`file://` URIs to human-readable paths. A custom oxlint rule
(`.oxlint/oxlint-plugin-no-showmessage.mjs`) enforces this -- direct
`connection.window.show*Message()` calls in server code produce lint errors.
Debug logs intentionally keep raw URIs to preserve diagnostic ability.

## Deliberate Non-Consolidations

Cases where apparent duplication is intentional. Each subsection explains why the
components stay separate.

### Separate CLIs

`fgfmt`, `fgtp`, `fgbin`, `ssl` and `tssl` stay separate bundles, each shipped in its own library package - one
package, one version and one tarball per tool. Shared scaffolding (argument parsing, file discovery, output modes)
is already extracted to `shared/cli/cli-utils.ts`; further consolidation was evaluated and costs more than it saves.

- The transpile bundle inlines ts-morph and drives a bundler, and the TSSL package depends on ts-morph at runtime;
  the format and binary bundles are small. A unified binary would load that toolchain on every `format` or
  `binary` invocation - a cold-start and install-size regression for the tools that do not need it.
- The tools do semantically different jobs: text round-trip, source-to-source transpilation, bytecode compilation,
  binary parsing. The shared surface is already shared at the right layer; the per-tool bodies are not duplicated.
- The `ssl` CLI does not use `shared/cli/cli-utils.ts`. Its argument grammar is the reference SSL compiler's rather
  than this repo's `--save`/`--check` convention, so that a build script written for that compiler can call it
  unchanged; sharing the parser would mean parameterising it into two unrelated grammars. Its own parser lives in
  `compilers/ssl/src/args.ts` and is shared with the language server, which reads the same command line out of the
  `compileOptions` setting.

### Two Separate TypeScript Plugins (tssl-plugin, td-plugin)

The plugins stay in separate packages. They intercept different tsserver methods and
have different initialization side effects; merging is mechanically feasible but not
worthwhile.

- **tssl-plugin** proxies `getSemanticDiagnostics`, `getSuggestionDiagnostics`, and
  `getQuickInfoAtPosition`; scopes by `.tssl` filename. Purely read-side filtering.
- **td-plugin** proxies `getCompletionsAtPosition` and also calls `overrideHost()` for every project it is
  created in, which rewrites the language service host: for a project containing `.td` files it adds the TD
  runtime declarations to the file list and drops the DOM lib from the compiler settings. A host mutation is a
  side effect the read-side tssl-plugin does not have.
- The two plugins are loaded side-by-side by tsserver via
  `contributes.typescriptServerPlugins` -- having them separate costs one extra plugin
  registration entry, nothing else at runtime. The build pipeline already calls the
  same `scripts/build-ts-plugin.sh` for both with different args.

### Two Feature Matrices (README + `server/INTERNALS.md`)

The feature matrix appears in two forms serving different audiences; both are maintained.

- **README** - user-facing languages ("Fallout SSL", "WeiDU TP2"), ✓ marks, includes a
  "Dialog editor" row. Optimized for someone deciding whether the extension supports
  their workflow.
- **`server/INTERNALS.md#feature-matrix`** - provider names (`fallout-ssl`, `weidu-tp2`),
  `Y`/`n/a`/blank distinction, covers extra providers (`weidu-log`, `worldmap`, `weidu-tra`,
  `fallout-msg`, `infinity-2da`, `scripts-lst`) that are internals relevant only to
  implementers.

Collapsing to either form would hide information the other audience needs. Both must be
updated when a user-visible feature ships;
`scripts/utils/test/feature-matrix-sync.test.ts` fails when the two disagree on the
feature/language surface they share.
