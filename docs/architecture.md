# Architecture

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) | [server/INTERNALS.md](../server/INTERNALS.md) | [scripts/README.md](../scripts/README.md)

High-level architecture of the BGforge MLS extension. For server-specific details
(provider registry, symbol system, data flow), see [server/INTERNALS.md](../server/INTERNALS.md).

## Table of Contents

- [System Overview](#system-overview)
- [Repository Layout](#repository-layout)
- [Build System](#build-system)
    - [Build Targets](#build-targets)
    - [Build Pipeline](#build-pipeline)
    - [Key Build Constraints](#key-build-constraints)
- [Client Architecture](#client-architecture)
    - [Extension Activation](#extension-activation)
    - [TypeScript Language Service Plugins](#typescript-language-service-plugins)
    - [Webview Panels](#webview-panels)
- [Server Architecture](#server-architecture)
    - [Providers](#providers)
    - [Transpilers](#transpilers)
- [CLI Tools](#cli-tools)
    - [Format CLI](#format-cli)
    - [Transpile CLI](#transpile-cli)
    - [Binary CLI](#binary-cli)
    - [Shared CLI Infrastructure](#shared-cli-infrastructure)
- [Grammar Architecture](#grammar-architecture)
    - [Tree-Sitter Grammars](#tree-sitter-grammars)
    - [TextMate Grammars](#textmate-grammars)
- [Data Pipeline](#data-pipeline)
- [Test Architecture](#test-architecture)
    - [Server Unit Tests](#server-unit-tests)
    - [Integration Tests](#integration-tests)
    - [E2E Tests](#e2e-tests)
- [Extension Packaging](#extension-packaging)
- [Latency Budgets](#latency-budgets)
- [Key Design Decisions](#key-design-decisions)

## System Overview

```
+-------------------+       IPC        +-------------------+
|   VSCode Client   | <--------------> |    LSP Server     |
|  (extension.ts)   |                  |   (server.ts)     |
+-------------------+                  +-------------------+
        |                                      |
        |  TS Language Service                  v
        |  (tsserver process)          +-------------------+
        v                             | ProviderRegistry  |
+-------------------+                 +-------------------+
| bgforge-tssl-     |                         |
|   plugin/index.js |    +--------+--------+--+--------+---------+
| bgforge-td-       |    |        |        |           |         |
|   plugin/index.js |    v        v        v           v         v
+-------------------+  Fallout  WeiDU   WeiDU       WeiDU    Fallout
                        SSL      BAF      D          TP2     Worldmap

+-------------------+
|   CLI Tools       |   Standalone, reuse server modules
|    fgfmt (cli.js) |   No VSCode dependency
|   transpile.js    |
|  bin-cli.js       |
+-------------------+
```

Three runtime processes:

1. **VSCode Client** -- extension activation, commands, webview panels, binary editor
2. **LSP Server** -- language features (completion, hover, definition, format, etc.)
3. **tsserver** -- TypeScript Language Service plugins for `.tssl` and `.td` files

CLI tools run independently, reusing server modules directly.

## Repository Layout

```
vscode-mls/
|
+-- client/                 VSCode extension client
|   +-- src/
|   |   +-- extension.ts        Entry point (activate/deactivate, LSP client)
|   |   +-- (TS plugins moved to plugins/ directory)
|   |   +-- indicator.ts            Server initialization progress indicator
|   |   +-- dialog-tree/            Dialog tree preview (webview panels)
|   |   +-- editors/                Binary .pro/.map editor (custom editor)
|   |   +-- parsers/                Binary file parsers (.pro/.map)
|   |   +-- test/                   E2E tests (mocha + vscode test runner)
|   +-- out/                    esbuild output
|
+-- server/                 LSP server (see server/INTERNALS.md for details)
|   +-- src/
|   |   +-- server.ts               LSP entry point: connection setup, debouncer wiring, handler registration
|   |   +-- provider-registry.ts    Routes requests to language providers
|   |   +-- language-provider.ts    Provider interface
|   |   +-- compile.ts              Compilation dispatch
|   |   +-- translation.ts          .tra/.msg inlay hints, hover, definition, and find references
|   |   +-- user-messages.ts        User message wrappers (auto-decode file:// URIs)
|   |   +-- safe-eval.ts            Safe expression evaluator (no eval())
|   |   +-- common.ts               Logging, file utilities
|   |   +-- settings.ts             User settings
|   |   +-- handlers/               Per-feature LSP request handlers (HandlerContext shared)
|   |   +-- core/                   Symbol system, URI normalization, patterns, debouncer, file index, compile-tmp helper
|   |   +-- shared/                 Cross-provider utilities
|   |   +-- fallout-ssl/            Fallout SSL provider (full IDE support)
|   |   +-- fallout-worldmap/       Worldmap provider (completion + hover)
|   |   +-- weidu-baf/              WeiDU BAF provider (format + compile)
|   |   +-- weidu-d/                WeiDU D provider (symbols, definition, rename, JSDoc hover)
|   |   +-- weidu-log/              WeiDU log provider (go-to-definition for mod paths)
|   |   +-- weidu-tp2/              WeiDU TP2 provider (full IDE support)
|   |   +-- tssl/                   TSSL dialog bridge (depends on tree-sitter + LSP)
|   |   +-- td/                     TD dialog bridge (depends on tree-sitter + LSP)
|   +-- data/                   YAML data files (game engine definitions)
|   +-- test/                   Unit tests (vitest)
|   +-- out/                    esbuild output + WASM files + JSON data
|
+-- cli/                    Standalone CLI tools
|   +-- bin/                    Binary parser CLI (.pro/.map -> JSON)
|   +-- test/                   CLI tests
|
+-- format/                 @bgforge/format package: formatters library + fgfmt CLI bin
|   +-- src/                    index.ts (library) + cli.ts (fgfmt bin)
|   +-- out/                    tsup output + WASM files
|
+-- shared/                 Pure TypeScript helpers shared across workspaces
|   +-- cli/                    Shared CLI utilities (used by format, transpile, bin)
|
+-- plugins/               TypeScript Language Service Plugins
|   +-- tssl-plugin/           TSSL plugin (TS6133 suppression, engine proc hover)
|   +-- td-plugin/             TD plugin (runtime injection, completion filtering)
|
+-- grammars/               Tree-sitter grammars (6 languages)
|   +-- fallout-ssl/            grammar.js, corpus tests, WASM output
|   +-- weidu-baf/
|   +-- weidu-d/
|   +-- weidu-tp2/
|   +-- fallout-msg/            Highlight-only (external editors)
|   +-- weidu-tra/              Highlight-only (external editors)
|
+-- syntaxes/               TextMate grammars (YAML source -> JSON)
|   +-- {lang}.tmLanguage.yml       Primary syntax highlighting
|   +-- {lang}-tooltip.tmLanguage.yml   Hover tooltip syntax
|   +-- bgforge-mls-*.tmLanguage.yml    Comment/string/docstring injection
|
+-- language-configurations/  VSCode language settings (brackets, comments, indent)
+-- themes/                 Color theme (BGforge Monokai) + icon theme
+-- snippets/               Code snippets (SSL, BAF, TP2)
+-- scripts/                Build, test, data generation scripts
+-- transpilers/            Transpiler implementations + user documentation
|   +-- common/                 Shared utilities (no package.json)
|   +-- tssl/                   @bgforge/tssl: TypeScript to Fallout SSL
|   +-- tbaf/                   @bgforge/tbaf: TypeScript to WeiDU BAF
|   +-- td/                     @bgforge/td: TypeScript to WeiDU D
|   +-- src/                    @bgforge/transpile: library entry (index.ts) + fgtp bin (cli.ts)
+-- external/               Game data (Fallout, Infinity Engine)
+-- resources/              Extension icon
+-- docs/                   Documentation
```

## Build System

All bundles use **esbuild** (not tsc). The monorepo uses **pnpm workspaces**.

### Build Targets

| Target        | Input                                   | Output                                      | Notes                                      |
| ------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| Client        | `client/src/extension.ts`               | `client/out/extension.js`                   | CJS, `vscode` external                     |
| Server        | `server/src/server.ts`                  | `server/out/server.js`                      | CJS, patches `import_meta` for WASM        |
| TSSL Plugin   | `plugins/tssl-plugin/src/index.ts`      | `node_modules/bgforge-tssl-plugin/index.js` | CJS, standalone                            |
| TD Plugin     | `plugins/td-plugin/src/index.ts`        | `node_modules/bgforge-td-plugin/index.js`   | CJS, standalone                            |
| Webviews      | `client/src/{dialog,binary}-webview.ts` | `client/out/*.js`                           | Browser context                            |
| Format lib    | `format/src/{index,cli}.ts`             | `format/out/{index,cli}.js`                 | ESM, tsup-bundled; cli.js is the fgfmt bin |
| Transpile lib | `transpilers/src/{index,cli}.ts`        | `transpilers/out/{index,cli}.js`            | ESM, tsup-bundled; cli.js is the fgtp bin  |
| Binary CLI    | `cli/bin/src/cli.ts`                    | `cli/bin/out/bin-cli.js`                    | CJS                                        |
| Grammars      | `grammars/*/grammar.js`                 | `grammars/*/*.wasm` -> `server/out/`        | tree-sitter build --wasm                   |
| TextMate      | `syntaxes/*.tmLanguage.yml`             | `syntaxes/*.tmLanguage.json`                | YAML -> JSON conversion                    |

### Build Pipeline

```
pnpm build
  |
  +-> build:client        esbuild client + TS plugins + bin CLI
  +-> build:server        esbuild server + copy WASM to server/out/
  +-> build:test          esbuild E2E test bundles
  +-> build:webviews      esbuild webview bundles

pnpm build:all            Full build: build:grammar + build + build:editors
pnpm build:dev            Minimal build for F5 development (skips CLIs)
```

`pnpm build` is the default repo-wide build, not the full build. Use `pnpm build:all`
when you need grammars and editor bundles too.

### Key Build Constraints

1. **WASM URL resolution**: web-tree-sitter uses `import.meta.url` for WASM loading.
   esbuild's CJS output shims `import.meta` as an empty object. Build scripts use
   `--banner:js` to define a `__imu` variable with the correct file URL, and
   `--define:import.meta.url=__imu` to replace references. This works reliably with
   `--minify` (the previous `sed` approach broke when esbuild mangled variable names).
2. **TS plugins**: Must be standalone CJS bundles in `node_modules/` directories.
   tsserver loads them by package name from `typescriptServerPlugins` in package.json.
3. **Externalized .d.ts imports**: Transpiler libraries (ielib, folib) use `.d.ts` for
   engine declarations. esbuild externalizes these; they pass through as bare identifiers.
   Libraries must use named re-exports, not `export *`.

### TypeScript configuration

esbuild emits all production code; `tsc` is used for type-checking only (`noEmit: true`).
`tsconfig.base.json` reflects this with `module: ESNext`, `moduleResolution: bundler`,
`verbatimModuleSyntax: true`, and `noEmit: true`. Two exceptions override the base:
scripts run via tsx/Node and need `module: NodeNext`; TS Language Service plugins require
`module: commonjs` and `verbatimModuleSyntax: false` because tsserver loads them as CJS
and they use `export = init` syntax.

## Client Architecture

### Extension Activation

The extension activates on language open or when the workspace contains transpiler files
(`.tssl`, `.tbaf`, `.td`). See `activationEvents` in package.json.

```
activate()
  |
  +-> Create LanguageClient (IPC transport to server)
  +-> Register commands (compile, dialog preview)
  +-> Register binary editor provider (.pro/.map files)
  +-> Register dialog tree webview panels
  +-> Start server (server/out/server.js)
```

**VSCode engine floor (1.73):** The extension requires VSCode 1.73 or later. The
binding constraint is `vscode.l10n.t()` in `client/src/indicator.ts`, which was
introduced in VSCode 1.73 (November 2022). Earlier APIs used by the extension —
`vscode.CustomEditorProvider` (1.46) and the `semanticTokenTypes` contribution
point (1.43) — are all satisfied by 1.73. The floor should be raised if a feature
requiring a later release is added.

### TypeScript Language Service Plugins

Plugins intercept tsserver calls for transpiler files. They run inside the tsserver
process, not the extension host.

- **TSSL Plugin** — suppresses TS6133 for engine procedures, adds hover docs. See [plugins/tssl-plugin/README.md](../plugins/tssl-plugin/README.md).
- **TD Plugin** — injects `td-runtime.d.ts`, filters completions per file type. See [plugins/td-plugin/README.md](../plugins/td-plugin/README.md).

### Webview Panels

Two webview-based features, each with a host-side and browser-side module:

| Feature            | Host Module                   | Webview Module            | Trigger                |
| ------------------ | ----------------------------- | ------------------------- | ---------------------- |
| Dialog Tree (SSL)  | `dialog-tree/dialogTree.ts`   | `dialogTree-webview.ts`   | Ctrl+Shift+V in SSL    |
| Dialog Tree (D/TD) | `dialog-tree/dialogTree-d.ts` | `dialogTree-webview.ts`   | Ctrl+Shift+V in D/TD   |
| Dialog Tree (TSSL) | `dialog-tree/dialogTree.ts`   | `dialogTree-webview.ts`   | Ctrl+Shift+V in TSSL   |
| Binary Editor      | `editors/binaryEditor.ts`     | `binaryEditor-webview.ts` | Open .pro or .map file |

Binary editor design choice:

Implementation checklist and extension plan for new binary formats live in [`client/src/parsers/README.md`](../client/src/parsers/README.md).

- `.map` files are parsed strictly in the custom editor. If strict parsing fails, the editor shows the parse errors instead of silently falling back to heuristic recovery.
- Graceful MAP fallback remains available in non-editor workflows such as the binary CLI via `--graceful-map`, where corpus parsing and opaque-byte round-tripping are more useful than an editable strict tree.
- The editor includes `Dump to JSON` and `Load from JSON` sidebar actions. Snapshots use extension-preserving sidecars such as `file.pro.json` and `file.map.json`.
- Binary JSON snapshots are canonical `schemaVersion: 1` documents for both `pro` and `map`. They are validated on dump and load. Legacy editor-tree snapshots are no longer supported.
- Both binary parsers now separate canonical data from presentation. Parser results still include a tree for the editor, but `ParseResult.document` is the canonical machine model and is the source of truth for JSON dump/load and binary serialization.
- Canonical rebuild during save and JSON export is strict about output validity. If a parsed PRO or MAP field is outside a supported domain range, the serializer clamps it to the nearest valid value before writing bytes or snapshots.
- Presentation metadata such as labels, enum/flag option tables, numeric formatting, and editability is defined separately in `client/src/parsers/presentation-schema.ts`, so external tools can consume the canonical data contract without inheriting the editor tree.
- Presentation lookups are keyed by stable semantic IDs such as `pro.header.objectType` and `map.scripts[].extents[].slots[].flags`. The old escaped tree-path lookup form is no longer part of the contract.
- MAP JSON snapshots remain fidelity snapshots. Any MAP region the editor intentionally omits from the visible tree, such as tiles or opaque tails, is still carried in the canonical snapshot so JSON round-trips remain byte-preserving.
- That byte preservation applies to omitted MAP regions and preserved fixed-width source bytes such as filename slots. Once a field is modeled and changed through the canonical document, JSON load/save treats the parsed value as authoritative and rewrites that field in canonical form.
- MAP snapshots are semantic documents, not field-layout dumps. Regular decoded MAP fields do not persist `offset`, `size`, `valueType`, or `nodeType`; those remain internal codec concerns. Offsets and sizes are only preserved in `opaqueRanges` for undecoded or intentionally omitted byte spans.
- MAP snapshots use a single persisted tile encoding: tile bytes must be stored in the `opaqueRanges` entry labeled `tiles`. Decoded tile snapshots are intentionally unsupported.
- JSON load in the custom editor intentionally stays strict for MAP files even when a snapshot was originally produced from a graceful parse. This is on purpose: ambiguous MAP bytes should not spread through normal editor workflows. Users who explicitly want to reload those ambiguous snapshots must use the binary CLI with `--graceful-map`.
- The custom editor intentionally omits MAP tile data. Tiles are large, mostly low-signal bulk data for editor workflows, so the editor skips materializing them entirely and preserves their bytes only for round-trip save/revert.
- The MAP editor hides a few script-entry struct slots that Fallout 2 CE still leaves as legacy or unknown internals. It keeps meaningful fields visible, renames them to match CE semantics where possible, and leaves the persisted program pointer slot read-only because the engine treats the saved pointer value as non-semantic.
- The editor sends a lazy tree model to the webview rather than one large pre-expanded JSON payload. Enum/flag choices are attached per field node, and MAP projection now lives in the tree builder instead of a separate compacted parse-result layer.
- Format-specific behaviour (snapshots, canonical rebuild, semantic key mapping, editor projection, structural edits) is encapsulated in `BinaryFormatAdapter` implementations registered in `client/src/parsers/format-adapter.ts`. Adding a new binary format requires implementing this interface alongside the parser. See `client/src/parsers/README.md` for the full checklist.
- Dialog tree preview and binary editor now share the same inline webview asset-cache helper (`client/src/webview-assets.ts`) for HTML/CSS/JS shell loading.

## Server Architecture

See [server/INTERNALS.md](../server/INTERNALS.md) for comprehensive documentation covering:

- Provider registry pattern and request routing
- Symbol system (IndexedSymbol, scope hierarchy, pre-computed responses)
- Include graph (workspace-wide rename via transitive dependant tracking)
- Data flow (initialization, hover fallthrough, file change propagation)
- Tree-sitter integration (sequential init, SyntaxType enum, parse caching)
- Translation service (.tra/.msg inlay hints)
- Adding a new provider

Two recent behavior points are easy to miss:

- Provider indexing is registry-driven via `indexExtensions`, not provider-specific startup scans.
- VS Code workspace-symbol search is scoped to the active document language for `fallout-ssl`, `weidu-d`, and `weidu-tp2`, so Ctrl+T does not mix symbols across languages.

### Providers

Each provider implements `ProviderBase` plus relevant capability interfaces from `core/capabilities.ts`
(e.g., `FormattingCapability`, `CompletionCapability`). The `LanguageProvider` type is a
`Partial<>` intersection of all capabilities — providers declare explicit `implements` clauses
for compile-time enforcement:

| Provider         | Completion | Hover | Signature | Definition | References | Format | Symbols | Workspace Symbols | Rename | Inlay | Folding | Diagnostics | JSDoc |
| ---------------- | :--------: | :---: | :-------: | :--------: | :--------: | :----: | :-----: | :---------------: | :----: | :---: | :-----: | :---------: | :---: |
| fallout-ssl      |     x      |   x   |     x     |     x      |     x      |   x    |    x    |         x         |   x    | .msg  |    x    |    sslc     |   x   |
| fallout-worldmap |     x      |   x   |           |            |            |        |         |                   |        |       |         |             |       |
| weidu-baf        |     x      |   x   |           |            |            |   x    |         |                   |        | .tra  |    x    |    weidu    |       |
| weidu-d          |     x      |   x   |           |     x      |     x      |   x    |    x    |         x         |   x    | .tra  |    x    |    weidu    |   x   |
| weidu-log        |            |       |           |     x      |            |        |         |                   |        |       |         |             |       |
| weidu-tp2        |     x      |   x   |           |     x      |     x      |   x    |    x    |         x         |   x    | .tra  |    x    |    weidu    |   x   |

### Transpilers

Three TypeScript-to-scripting-language transpilers share a common pipeline:

```
Source (.tssl/.tbaf/.td)
  |
  +-> Extract @tra tag (esbuild strips comments)
  +-> Bundle imports (esbuild, shared bundler)
  +-> Parse AST (ts-morph)
  +-> Transform to IR (language-specific)
  +-> Emit target language text
  +-> Write output file
  +-> Optional: chain native compilation
```

The four internal packages (`common`, `tssl`, `tbaf`, `td`) stay private. The
publishable library lives at the `transpilers/` root as `@bgforge/transpile`
and bundles all four into a single ESM artifact via `tsup`. Internal consumers
(LSP server, TS plugins) keep importing the per-language packages directly;
external consumers use the bundled library. `esbuild-wasm` is the only runtime
dependency — it cannot be inlined because it detects bundling at load time.

**Shared pipeline** (`transpilers/common/transpiler-pipeline.ts`): `createTranspiler()` factory
handles the common orchestration — extension validation, @tra tag extraction, file I/O,
and structured compile events such as `output_written`. The shared pipeline does not
write to stdout; host-specific callers decide whether to surface those events as LSP
messages, CLI stderr output, or ignore them. TBAF and TD use this factory; TSSL has
custom entry points due to its batch state and non-standard output path.

**Shared utilities** (`transpilers/common/transpiler-utils.ts`): variable substitution, loop unrolling
(max 1000 iterations), array spread/destructuring, helper fixups (obj/tra/tlk),
point tuple conversion (`[x, y]` -> `[x.y]`), @tra tag extraction.

**Shared bundler** (`transpilers/tbaf/src/bundle.ts`): esbuild-wasm with externalized `.d.ts` imports,
enum transformation plugin, extensionless import resolution. Used by TBAF and TD
directly; TSSL calls `bundleWithEsbuild()` directly with preserved-function tracking.
TBAF/TD skip bundling for import-free files (`hasImports()` guard); TSSL always bundles
because enums are a first-class feature, inline function extraction depends on bundling,
and enum property expansion needs all bundled enum names.

**Architecture differences**: TSSL emits directly from AST (no IR). TBAF uses a
structured IR (`BAFBlock/Condition/Action`) with condition algebra (boolean to
CNF conversion for BAF OR groups). TD has the richest IR (20+ construct types)
with state machines, method chain parsing, and dual-pass orphan detection.

| Transpiler | Input   | Output | Key Features                                                                                                  |
| ---------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| TSSL       | `.tssl` | `.ssl` | const/let, loops, functions, enum pre-transform                                                               |
| TBAF       | `.tbaf` | `.baf` | for/for-of, arrays, spread, destructuring, function inlining, point tuples                                    |
| TD         | `.td`   | `.d`   | All TBAF features + conditionals, method chains, transitive state collection, orphan warnings, dialog preview |

**TD module structure** (`transpilers/td/src/`):

| Module                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `index.ts`             | Entry point, bundling, orphan detection on original source |
| `parse.ts`             | AST walker: ts-morph AST -> IR                             |
| `parse-helpers.ts`     | Utility functions (evaluate, resolve, validate)            |
| `expression-eval.ts`   | Expression -> trigger/action/text conversion               |
| `chain-parsing.ts`     | Method chain transition parsing                            |
| `chain-processing.ts`  | Chain body processing (from/fromWhen/say)                  |
| `state-transitions.ts` | State/transition processing, loop unrolling                |
| `state-resolution.ts`  | Post-parse BFS transitive collection, orphan detection     |
| `patch-operations.ts`  | Patch operation transforms (ALTER_TRANS, etc.)             |
| `emit.ts`              | IR -> D text serialization                                 |
| `types.ts`             | IR types (TDScript, TDConstruct, TDState, TDSay, etc.)     |
| `td-runtime.d.ts`      | TypeScript declarations for TD API                         |

`dialog.ts` (dialog tree preview, `parseTDDialog`) lives in `server/src/td/` — it depends on tree-sitter parsers and LSP infrastructure and was not extracted.

## CLI Tools

Standalone command-line tools that reuse server modules without VSCode dependency.

### Format CLI

```
fgfmt <file|dir> [--save] [--check] [-r] [-q]
```

Formats Fallout SSL, WeiDU BAF/D/TP2, WeiDU TRA, Fallout MSG, Infinity Engine 2DA, and
Fallout scripts.lst files. Parser-based formats (SSL/BAF/D/TP2) use tree-sitter and
respect `.editorconfig`. String-based formats (TRA/MSG/2DA/scripts.lst) require no parser.
Includes WASM parser modules. Ships as the `fgfmt` bin entry in `@bgforge/format`; the
library entry exposes the formatters for use in custom build pipelines.

### Transpile CLI

```bash
fgtp <file|dir> [--save] [--check] [-r] [-q]
```

Transpiles `.tssl`, `.tbaf`, `.td` files to their target formats. Uses ts-morph
and native esbuild in the standalone CLI build (`--alias:esbuild-wasm=esbuild`).
Reports orphan warnings for TD files.

### Binary CLI

```
node bin-cli.js <file.pro|file.map|dir> [--save] [--check] [--load] [--graceful-map] [-r] [-q]
```

Parses Fallout `.pro` and `.map` binary files and outputs structured JSON. `--load` writes JSON back using the parser's native extension, and `--graceful-map` allows ambiguous MAP object boundaries to fall back to opaque bytes for corpus and round-trip workflows.
Snapshots are saved as extension-preserving sidecars such as `file.pro.json` and `file.map.json`.

Snapshot contract:

- Snapshots are canonical `schemaVersion: 1` JSON documents, not editor-tree dumps.
- `pro` and `map` both dump/load through format-specific canonical schemas.
- Dump and load both validate snapshots, then reload bytes through the native parser as a round-trip safety check.
- `map` snapshots are semantic and do not expose normal field layout metadata; byte-preservation metadata lives in `opaqueRanges` only.
- Ambiguous MAP snapshots intentionally require `--graceful-map` again on load.

### Shared CLI Infrastructure

`shared/cli/cli-utils.ts` provides:

- Argument parsing (`--save`, `--check`, `-r`, `-q`)
- File discovery (single file or recursive directory scan)
- Diff reporting (colorized, for `--check` failures)
- Error handling wrapper

## Grammar Architecture

### Tree-Sitter Grammars

Six tree-sitter grammars compiled to WASM (4 LSP + 2 highlight-only for external editors).
See [grammars/README.md](../grammars/README.md) for the full list, build commands,
WASM rationale, and type generation details.

### TextMate Grammars

TextMate grammars (in `syntaxes/`) provide syntax highlighting. Source is YAML,
converted to JSON at build time. Includes:

- 11 primary language grammars
- 4 tooltip grammars (hover rendering)
- 3 injection grammars (comments, strings, docstrings)

## Data Pipeline

Game engine definitions flow from YAML sources to runtime. See [data-pipeline.md](data-pipeline.md) for the full diagram.

Summary:

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

YAML data files (~1.7 MB total):

| File                       | Contents                                    |
| -------------------------- | ------------------------------------------- |
| `fallout-ssl-base.yml`     | Fallout SSL functions, variables, constants |
| `fallout-ssl-sfall.yml`    | Sfall extension library                     |
| `weidu-baf-base.yml`       | BAF triggers and actions                    |
| `weidu-baf-ids.yml`        | IDS file entries (auto-generated)           |
| `weidu-baf-iesdp.yml`      | IESDP triggers and actions                  |
| `weidu-d-base.yml`         | D file functions                            |
| `weidu-tp2-base.yml`       | TP2 functions and macros                    |
| `fallout-worldmap-txt.yml` | Worldmap key-value pairs                    |

## Test Architecture

See [scripts/README.md](../scripts/README.md) for all test commands.

Four test layers:

### Server Unit Tests

- **Server unit tests** (`server/test/`, vitest) -- a couple thousand tests covering providers, transpilers, core symbol system, shared utilities. Run `pnpm exec vitest --run --reporter=verbose 2>/dev/null | tail` for the current count.

### Integration Tests

- **Integration tests** -- grammar corpus, TD/TBAF sample transpilation, format comparison, CLI exit codes

### E2E Tests

- **E2E tests** (`client/src/test/`, mocha + vscode) -- completion, hover in a real VSCode instance
- **Grammar tests** (`grammars/*/test/corpus/`) -- tree-sitter corpus tests per grammar

## Extension Packaging

`.vscodeignore` uses a **blocklist** strategy (exclude dev files, keep runtime files by default). See [docs/ignore-files.md](ignore-files.md) for the full list
and rationale.

**Packaging pipeline** (`scripts/package.sh`):

1. Run prepublish build (with full pnpm deps available)
2. Deref pnpm symlinks for server runtime deps, strip all other symlinks
3. Run `pnpm vsce package --no-dependencies` (skips vsce's npm list check)
4. Inject TS plugins into VSIX via `zip -g` (vsce excludes root `node_modules/` with `--no-dependencies`)
5. Restore `server/node_modules/` via `pnpm install` (EXIT trap)

**Runtime dependencies** that must ship in the VSIX:

| Dependency                | Location               | Why not bundled                       |
| ------------------------- | ---------------------- | ------------------------------------- |
| sslc-emscripten-noderawfs | `server/node_modules/` | Loaded via `fork()`, separate process |
| esbuild-wasm              | `server/node_modules/` | esbuild `--external`, WASM binary     |
| bgforge-tssl-plugin       | `node_modules/`        | Loaded by tsserver by package name    |
| bgforge-td-plugin         | `node_modules/`        | Loaded by tsserver by package name    |

See [docs/ignore-files.md](ignore-files.md#packaging-notes) for `.vscodeignore` details.

## Latency Budgets

The server wraps hot LSP handlers with `timeHandler` (in `server/src/shared/time-handler.ts`).
When a handler exceeds the threshold it logs a `[lsp-timing]` warning to the LSP console.
The threshold is `DEFAULT_THRESHOLD_MS = 50` ms and can be overridden at startup via the
`BGFORGE_LSP_SLOW_MS` environment variable.

The threshold is a per-request, per-call budget — not an aggregate. A single request that
takes longer than 50 ms triggers a warning regardless of prior request history.

Handlers currently wrapped: `onCompletion`, `onHover`, `onDefinition`, `onReferences`,
`onDocumentSymbol`, `semanticTokens`, `onWorkspaceSymbol`.

### Per-Operation Targets

No measured baselines exist in the repo yet. The targets below are initial values derived
from the default threshold; refine them once real baselines are captured in CI or profiling
sessions. If a new provider is added, re-measure all wrapped handlers with the new language
loaded and update this table.

| Operation                                                | Budget      | Notes                                                             |
| -------------------------------------------------------- | ----------- | ----------------------------------------------------------------- |
| Completion (`onCompletion`)                              | 50 ms       | Responses are pre-computed O(1) lookups; budget is the threshold. |
| Hover (`onHover`)                                        | 50 ms       | Same O(1) lookup model.                                           |
| Definition / References (`onDefinition`, `onReferences`) | 50 ms       | May walk include graph; budget is the threshold.                  |
| Workspace symbol (`onWorkspaceSymbol`)                   | 50 ms       | Iterates all indexed symbols; cancellation checked periodically.  |
| Document symbol (`onDocumentSymbol`)                     | 50 ms       | Per-file tree traversal; budget is the threshold.                 |
| Server startup (provider initialization)                 | Not wrapped | Sequential WASM loads; not currently measured by `timeHandler`.   |

The startup path is not wrapped because providers initialize sequentially by design (see
[Sequential Provider Initialization](#sequential-provider-initialization)) and the
initialization latency is dominated by WASM load time, which is not actionable per request.

### When to Revisit

- A new provider is added: re-measure all hot paths with the new language loaded.
- A new data file or YAML source is significantly larger than existing ones: re-check
  `onCompletion` and `onHover` budgets.
- A stricter SLO is adopted project-wide: update `DEFAULT_THRESHOLD_MS` and this table
  together so the code and docs stay in sync.

## Key Design Decisions

### LSP + Provider Registry

All language features route through a single LSP server with a provider registry.
Providers implement an optional interface -- each language only implements what it
supports. This avoids separate servers per language while keeping providers decoupled.

### Tree-Sitter for Parsing, ts-morph for Transpiling

Tree-sitter (WASM) handles the niche scripting languages -- it's fast, incremental,
and grammar-driven. ts-morph handles transpiler input (TypeScript subset) -- it provides
a full TypeScript AST with type information.

### Pre-Computed Responses

LSP responses (completion items, hover markdown, signature help) are computed once at
parse/index time and stored in `IndexedSymbol`. Requests are O(1) lookups. This trades
memory for latency.

### Sequential Provider Initialization

web-tree-sitter uses a shared `TRANSFER_BUFFER` for JS/WASM communication. Concurrent
`Language.load()` calls corrupt parser state. Providers initialize sequentially.

### Standalone CLIs Reuse Server Code

Format and transpile CLIs import server modules directly. No code duplication. CLIs
are esbuild-bundled to single files with no VSCode dependency.

### TypeScript Plugins for Transpiler Languages

`.tssl` and `.td` files are valid TypeScript subsets. TS plugins intercept tsserver to
suppress false errors and inject engine documentation, giving users full TypeScript
tooling (type checking, refactoring, go-to-definition) alongside transpiler features.

### Dependency Stability Policy

Dependency bumps stay within the current major version. `pnpm update -r` is run
periodically to pick up minor and patch releases across the workspace; major bumps
(including 0.x → 0.y where y > current, which npm treats as breaking) are deferred
until an explicit, motivated upgrade pass. This trades currency for stability: strict
mode, `verbatimModuleSyntax`, and the custom TS config make major-bump churn expensive,
and the extension's user surface is small enough that we gain little from being on the
absolute newest release of every library.

### Scope-Aware Symbol Lookup

Symbol resolution respects language visibility rules automatically (SSL procedure scope,
TP2 first-assignment-wins, D dialog-scoped composite keys). Lookups never cross scope
boundaries, so features don't need to post-filter results.

### File-Level Index Granularity

Edits update only the changed file's entry in the symbol and references indexes, not the
whole workspace. Keeps incremental updates cheap on large mod repos.

### Fallthrough Resolution Pattern

Features try resolution sources in order: local AST -> static data index -> translation
service. Each step returns `undefined` to continue to the next source or `null` to stop.
This keeps language-specific precedence rules explicit at call sites rather than baked
into shared helpers.

### Intentional Per-Language Implementations

Several features have separate implementations per provider that may look like duplication
but are intentionally language-specific. Shared infrastructure lives in `server/src/shared/`;
the per-language bodies encode genuinely different semantics:

| Feature                    | Why per-language                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Definition finders         | Different scoping models (SSL procedures vs TP2 functions vs D state labels)                                                                                                                                                                                                                                                                                         |
| Document symbol extraction | Different construct types and scoping: SSL has explicit `variable` declarations, TP2 uses first-assignment-wins deduplication. Both show params/vars as children. TP2 uses `hasError` guard to skip error-recovery artifacts; icon assignment uses shared `looksLikeConstant()` heuristic (cross-linked: `symbol.ts`, `hover.ts`, `tree-utils.ts`, `tmLanguage.yml`) |
| Rename                     | SSL is workspace-wide via ReferencesIndex; TP2 is single-file with %var% handling                                                                                                                                                                                                                                                                                    |
| Reference finders          | SSL has procedure scope shadows; TP2 has synthetic string nodes; D uses dialog-scoped composite keys                                                                                                                                                                                                                                                                 |
| Call-site extractors       | SSL indexes all identifiers; TP2 indexes only function/macro names (case-sensitive); D uses dialog:label composite keys                                                                                                                                                                                                                                              |
| Folding block type sets    | Language-specific node types, passed as parameters to shared `getFoldingRanges()`                                                                                                                                                                                                                                                                                    |
| Comment stripping          | `stripCommentsWeidu()` handles `~string~` delimiters; `stripCommentsFalloutSsl()` does not                                                                                                                                                                                                                                                                           |

### Tree-Sitter Error Recovery Defense

Tree-sitter error recovery can fabricate structurally valid nodes from broken input.
When the user is mid-typing a keyword (e.g. `COPY_EXISTN` instead of `COPY_EXISTING`),
error recovery may produce a `patch_assignment` node with a phantom zero-width `=`
operator. Without protection, this creates spurious variable completions with wrong
types.

Two defense layers prevent this:

1. **`isPhantomAssignment()`** (`tree-utils.ts`) -- rejects assignment nodes where the
   operator has zero width (inserted by error recovery, not present in source). Applied
   in both `localCompletion()` and `extractVariables()`.
2. **`excludeWord`** (`provider.ts`) -- excludes the word at cursor from local completions
   in all paths, not just declaration sites. Prevents self-referencing completion even if
   layer 1 is bypassed by future error recovery changes.

Design limitation: layer 1 relies on observed tree-sitter behavior (zero-width phantom
operators), not a documented guarantee. Layer 2 provides backup. Both must fail for a
regression to occur. See `isPhantomAssignment()` JSDoc for alternatives considered.

Only TP2 is affected because it has bare assignment syntax (`foo = 5` without a keyword).
Other providers (SSL, BAF, D) don't have bare assignment grammar rules, so error recovery
cannot produce phantom assignment nodes for them.

Document symbols (`symbol.ts`) use a separate defense: `node.hasError` guards on all
variable-extracting code paths (`extractFileLevelVars`, `collectBodyVars`). This skips
nodes where tree-sitter's error recovery inserted phantom tokens. The guard still recurses
into children, so valid variables inside an ACTION_IF with partial errors are still
collected.

### URI Normalization (Gateway Pattern)

On Windows, VSCode and Node's `pathToFileURL()` produce different percent-encodings for
the same file (e.g., `%21` vs `!`, `%3A` vs `:`). Using raw URI strings as Map/Set keys
causes silent mismatches when the same file enters via different paths (LSP at runtime
vs `pathToUri` at startup).

The `NormalizedUri` branded type (`core/normalized-uri.ts`) canonicalizes `file://` URIs
via a `fileURLToPath` -> `pathToFileURL` round-trip. `ProviderRegistry` normalizes all
URIs at the gateway before passing to providers.

The branded type is enforced at storage boundaries: `Symbols.files`,
`ReferencesIndex.files`, `FileIndex` methods, the `UriDebouncer` instances
in `core/uri-debouncer.ts`, and `activeCompiles` maps in compilers all use
`Map<NormalizedUri, ...>`. `pathToUri()`
returns `NormalizedUri` since it produces canonical encoding. Providers cast at the
boundary where they pass URIs to storage (`uri as NormalizedUri`), documented with a
comment explaining the gateway guarantee.

### User-Facing Message Wrappers

All user-visible messages (`showInformationMessage`, `showWarningMessage`,
`showErrorMessage`) go through wrappers in `user-messages.ts` that auto-decode
`file://` URIs to human-readable paths. A custom oxlint rule
(`.oxlint/oxlint-plugin-no-showmessage.ts`) enforces this -- direct
`connection.window.show*Message()` calls in server code produce lint errors.
Debug logs intentionally keep raw URIs to preserve diagnostic ability.

## Deliberate Non-Consolidations

Cases where apparent duplication is intentional. Each subsection explains why the
components stay separate.

### Three Separate CLIs (format, transpile, bin)

`format/` (fgfmt bin), `transpilers/` (fgtp bin), and `cli/bin` stay as separate bundles.
Shared scaffolding (argument parsing, file discovery, output modes) is already extracted to
`shared/cli/cli-utils.ts`; further consolidation was evaluated and costs more than it saves.

- The transpile bundle is ~12 MB (owns `esbuild` + `ts-morph` + transform passes). Format
  and bin bundles are small. A unified binary would load the transpile toolchain on every
  `format` or `bin` invocation -- cold-start and install-size regression for the two use
  cases that don't need it.
- The three tools do semantically different jobs: text round-trip, source-to-source
  compilation, binary parsing. The shared surface is already shared at the right layer
  (`shared/cli/cli-utils.ts`); the per-tool bodies are not duplicated.
- The format CLI ships as the `fgfmt` bin entry within `@bgforge/format`, and the transpile
  CLI ships as the `fgtp` bin entry within `@bgforge/transpile`, so each library and its CLI
  share one package, one version, and one tarball without coupling to the other tools.

### Two Separate TypeScript Plugins (tssl-plugin, td-plugin)

The plugins stay in separate packages. They intercept different tsserver methods and
have different initialization side effects; merging is mechanically feasible but not
worthwhile.

- **tssl-plugin** proxies `getSemanticDiagnostics`, `getSuggestionDiagnostics`, and
  `getQuickInfoAtPosition`; scopes by `.tssl` filename. Purely read-side filtering.
- **td-plugin** proxies `getCompletionsAtPosition` and also calls `overrideHost()` to
  inject the TD runtime into the language service host. That host mutation runs once
  per plugin load; a merged plugin would run it for every TypeScript project, even
  those with no `.td` files, widening the blast radius of that side effect.
- The two plugins are loaded side-by-side by tsserver via
  `contributes.typescriptServerPlugins` -- having them separate costs one extra plugin
  registration entry, nothing else at runtime. The build pipeline already calls the
  same `scripts/build-ts-plugin.sh` for both with different args.

### Two Feature Matrices (README + `server/INTERNALS.md`)

The feature matrix appears in two forms serving different audiences; both are maintained.

- **README** — user-facing languages ("Fallout SSL", "WeiDU TP2"), ✓ marks, includes a
  "Dialog preview" row. Optimized for someone deciding whether the extension supports
  their workflow.
- **`server/INTERNALS.md#feature-matrix`** — provider names (`fallout-ssl`, `weidu-tp2`),
  `Y`/`n/a`/blank distinction, covers extra providers (`weidu-log`, `worldmap`, `weidu-tra`,
  `fallout-msg`, `infinity-2da`, `scripts-lst`) that are internals relevant only to
  implementers.

Collapsing to either form would hide information the other audience needs. Both must be
updated when a user-visible feature ships.
