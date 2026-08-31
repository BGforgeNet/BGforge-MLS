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
  - [SSL CLI](#ssl-cli)
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
|    fgbin (cli.js) |
|      ssl (cli.js) |
|     tssl (cli.js) |
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
|   |   +-- extension.ts            Entry point (activate/deactivate, LSP client)
|   |   +-- logging.ts              Output channel + conlog wrapper (gated on bgforge.debug)
|   |   +-- webview-utils.ts        In-webview helpers (fatal-error handler, init timeout, benign-error filter)
|   |   +-- webview-assets.ts       HTML/CSS/JS asset cache shared by webview panels
|   |   +-- webview-error.ts        Webview runtime error surfacing (DevTools + output + toast)
|   |   +-- dialog-editor/          Dialog Editor (custom text editor + Svelte webview; @xyflow/svelte graph)
|   |   +-- binary-editor/          Binary .pro/.map/.itm/.spl/.eff/.cre custom editor (worker thread + Svelte webview; uses @bgforge/binary + @bgforge/binary-editor)
|   |   +-- image-editor/           Animation editor for Fallout FRM / IE BAM (custom editor + Svelte webview; uses @bgforge/image)
|   |   +-- ie-resources/           IE game resource viewer: sidebar tree over an installed game, plus the bgforge-ie-resource: FileSystemProvider that lets the editors open and save resources out of chitin.key/BIF and override/
|   |   +-- script-view/            bgforge-script: FileSystemProvider backing the read-and-recompile views below
|   |   +-- bcs-editor/             Compiled IE script (.bcs/.bs) view: decompiles to BAF, recompiles on save
|   |   +-- int-editor/             Compiled Fallout script (.int) view: disassembles to readable text
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
|   |   +-- logger.ts               Logging (routes through the LSP connection console)
|   |   +-- path-utils.ts           Filesystem path/containment/glob helpers
|   |   +-- settings.ts             User settings
|   |   +-- process-runner.ts       External-compiler spawn with whitelist wrapper parsing
|   |   +-- handlers/               Per-feature LSP request handlers (HandlerContext shared)
|   |   +-- core/                   Symbol system, URI normalization, patterns, debouncer, file index, compile-tmp helper
|   |   +-- shared/                 Cross-provider utilities
|   |   +-- fallout-ssl/            Fallout SSL provider (full IDE support)
|   |   +-- fallout-worldmap/       Worldmap provider (completion + hover)
|   |   +-- infinity-2da/           Infinity Engine 2DA provider (semantic tokens)
|   |   +-- weidu-baf/              WeiDU BAF provider (format + compile)
|   |   +-- weidu-d/                WeiDU D provider (symbols, definition, rename, JSDoc hover)
|   |   +-- weidu-log/              WeiDU log provider (go-to-definition for mod paths)
|   |   +-- weidu-tp2/              WeiDU TP2 provider (full IDE support)
|   |   +-- sslc/                   Built-in WASM SSL compiler bridge (sslc-emscripten-noderawfs)
|   |   +-- tssl/                   TSSL dialog bridge (depends on tree-sitter + LSP)
|   |   +-- td/                     TD dialog bridge (depends on tree-sitter + LSP)
|   +-- data/                   YAML data files (game engine definitions)
|   +-- test/                   Unit tests (vitest)
|   +-- out/                    esbuild output + WASM files + JSON data
|
+-- binary/                 @bgforge/binary package: parsers library + fgbin CLI bin
|   +-- src/                    index.ts (library) + cli.ts (fgbin bin) + format adapters
|   +-- test/                   Library + CLI tests (vitest)
|   +-- out/                    tsdown output
|
+-- binary-editor/          @bgforge/binary-editor package: declarative layout layer (parsed records -> editor blocks)
|   +-- src/                    layout/model/session/spellbook/cross-record projection consumed by the client webview
|   +-- test/                   Layout + structure-op tests (vitest) + Playwright render harness (test/harness/, e2e-tier)
|
+-- format/                 @bgforge/format package: formatters library + fgfmt CLI bin
|   +-- src/                    index.ts (public library) + internal.ts (in-repo helpers) + cli.ts (fgfmt bin)
|   +-- out/                    tsdown output + WASM files
|
+-- image/                  @bgforge/image package: animation library (Fallout FRM / IE BAM codecs, indexed <-> true-colour conversion, PNG/APNG import-export)
|   +-- src/                    Codecs (frm/, bam/, png/, palette/, pvrz/) + conversions (convert/, quantize/) + PNG-directory/APNG io (io/)
|   +-- test/                   Library tests (vitest)
|   +-- out/                    tsdown output
|
+-- compilers/              Compilers, one per source language (transpilers/ holds the ones that emit source)
|   +-- ssl/                    @bgforge/ssl package: Fallout SSL -> INT compiler + the `ssl` CLI bin (private)
|   |   +-- src/                    preprocess/lower/optimize + int/ back end, cli.ts (the `ssl` bin)
|   |   +-- test/                   Library + CLI tests (vitest) + corpus differentials (test/integration/)
|   |   +-- out/                    tsdown output + WASM files
|   +-- tssl/                   @bgforge/tssl package: TypeScript -> Fallout INT compiler + the `tssl` CLI bin
|   +-- bcs/                    @bgforge/bcs package: IE BCS codec + BAF compile/decompile (private, no CLI)
|
+-- shared/                 Pure TypeScript helpers shared across workspaces
|   +-- cli/                    Shared CLI utilities (used by format, transpile, bin)
|   +-- parsers/                Tree-sitter parser factory/manager + per-language facades + WASM
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
+-- editors/                Hand-written editor syntax inputs, merged with generated output by build-editors.sh
+-- language-configurations/  VSCode language settings (brackets, comments, indent)
+-- themes/                 Color theme (BGforge Monokai) + icon theme
+-- snippets/               Code snippets (SSL, BAF, TP2)
+-- scripts/                Build, test, data generation scripts
+-- actions/                Reusable composite GitHub Actions (binary, format, transpile, tssl) + _shared/ scripts
+-- transpilers/            Transpiler implementations + user documentation
|   +-- common/                 Shared utilities (@bgforge/transpiler-common, workspace-internal)
|   +-- tbaf/                   @bgforge/tbaf: TypeScript to WeiDU BAF
|   +-- td/                     @bgforge/td: TypeScript to WeiDU D
|   +-- src/                    @bgforge/transpile: library entry (index.ts) + fgtp bin (cli.ts)
+-- external/               Game data (Fallout, Infinity Engine)
+-- resources/              Extension icon
+-- docs/                   Documentation
```

`transpilers/common/` predates the repo-wide use of "shared" for this role (`shared/` now holds the helpers used by
both runtime and build-time code). The name stays: renaming it would churn roughly 40 files plus the
`@bgforge/transpiler-common` package name for no functional gain.

## Build System

All bundles use **esbuild** (not tsc). The monorepo uses **pnpm workspaces**.

### Build Targets

| Target        | Input                                                                   | Output                                      | Notes                                            |
| ------------- | ----------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------ |
| Client        | `client/src/extension.ts`                                               | `client/out/extension.js`                   | CJS, `vscode` external                           |
| Server        | `server/src/server.ts`                                                  | `server/out/server.js`                      | CJS, patches `import_meta` for WASM              |
| TSSL Plugin   | `plugins/tssl-plugin/src/index.ts`                                      | `node_modules/bgforge-tssl-plugin/index.js` | CJS, standalone                                  |
| TD Plugin     | `plugins/td-plugin/src/index.ts`                                        | `node_modules/bgforge-td-plugin/index.js`   | CJS, standalone                                  |
| Webviews      | `client/src/{dialog-editor,binary-editor,image-editor}/webview/main.ts` | `client/out/*.js`                           | Browser context, built as part of `build:client` |
| Format lib    | `format/src/{index,cli}.ts`                                             | `format/out/{index,cli}.js`                 | ESM, tsdown-bundled; cli.js is the fgfmt bin     |
| Transpile lib | `transpilers/src/{index,cli}.ts`                                        | `transpilers/out/{index,cli}.js`            | ESM, tsdown-bundled; cli.js is the fgtp bin      |
| Binary lib    | `binary/src/{index,cli}.ts`                                             | `binary/out/{index,cli}.js`                 | ESM, tsdown-bundled; cli.js is the fgbin bin     |
| SSL lib       | `compilers/ssl/src/{index,cli}.ts`                                      | `compilers/ssl/out/{index,cli}.js`          | ESM, tsdown-bundled; cli.js is the `ssl` bin     |
| Grammars      | `grammars/*/grammar.js`                                                 | `grammars/*/*.wasm` -> `server/out/`        | tree-sitter build --wasm                         |
| TextMate      | `syntaxes/*.tmLanguage.yml`                                             | `syntaxes/*.tmLanguage.json`                | YAML -> JSON conversion                          |

### Build Pipeline

```
pnpm build
  |
  +-> build:client        esbuild client + TS plugins + webview bundles
  +-> build:server        esbuild server + copy WASM to server/out/
  +-> build:test          esbuild E2E test bundles
  +-> build:transpile     @bgforge/transpile library + fgtp CLI (tsdown)
  +-> build:format        @bgforge/format library + fgfmt CLI (tsdown)
  +-> build:binary        @bgforge/binary library + fgbin CLI (tsdown)
  +-> build:ssl           @bgforge/ssl library + ssl CLI (tsdown)

pnpm build:all            Full build: build:grammar + build + build:editors + build:transpile
pnpm build:dev            Minimal build for F5 development (skips CLIs, linting, tests)
```

`pnpm build` is the default repo-wide build, not the full build. Use `pnpm build:all`
when you need grammars and editor bundles too. `build:webviews` is no longer a
separate top-level step - it runs inside `build:client`.

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
4. **Library bundlers (tsdown)**: `@bgforge/binary`, `@bgforge/format`, and `@bgforge/transpile`
   bundle via tsdown (Rolldown-based, the maintained successor to tsup). Each `tsdown.config.ts`
   emits ESM `out/index.js` + `out/cli.js` (Rolldown shares code between them via an automatic
   chunk), `out/index.d.ts` for the library entry only (the CLI is a bin, not an imported
   module), and a banner re-creating the CJS globals (`createRequire` / `__filename` /
   `__dirname`) so inlined CJS resolves in the ESM bundle. `fixedExtension: false` keeps the
   `.js` extension the `type: module` packages expect (it defaults to `.mjs` on node). transpile
   externalizes `esbuild-wasm` (it refuses to be bundled - it inspects its own `__filename`);
   format copies the tree-sitter WASM next to the CLI via an `onSuccess` hook and has a second
   library entry, `out/internal.js` + `.d.ts`, behind the `./internal` subpath export - helpers the
   server and the tests need that are shaped by the grammars and so carry no semver promise.

   Moving off tsup required one source change. The grammars' `SyntaxType` enum used to live only
   in the generated `tree-sitter.d.ts`, and an enum in a `.d.ts` has no runtime representation:
   esbuild inlined its members, but Rolldown follows tsc's strict "`.d.ts` is types-only" rule -
   it erases the enum (so `node.type === SyntaxType.X` resolved against `undefined` and dropped
   content during formatting) and Rolldown 1.1.x refuses to parse the declaration-only `.d.ts`
   at all. The type-generation pipeline now splits the enum into a runtime `syntax-type.ts`
   (`scripts/split-syntax-type.mjs`, wired into each grammar's `generate:types` and
   `scripts/build-grammar.sh`); the `tree-sitter.d.ts` keeps the node-type declarations and
   imports the enum as a type. With the enum a real runtime module, every bundler resolves it.

   The runtime enum's canonical home is `shared/syntax-types/<grammar>.ts`, and
   `server/src/<grammar>/syntax-type.ts` is a one-line re-export shim of it. This keeps
   `@bgforge/format` (which needs the enum for its formatters) off `server/` internals: it imports
   `../../../shared/syntax-types/<grammar>` instead, so `format` no longer forms a source cycle with
   `server` and typechecks standalone. Server code imports the shim at `./syntax-type` unchanged.

5. **Server runtime dependencies**: `scripts/build-base-server.sh` bundles the LSP server with only
   `vscode` and `esbuild-wasm` externalized - every other dependency (ts-morph, web-tree-sitter,
   fast-glob, p-limit, yaml, the LSP libraries) is inlined into `out/server.js`. So
   `@bgforge/mls-server`'s `package.json` declares only `esbuild-wasm` as a runtime `dependency`
   (plus the optional `sslc-emscripten-noderawfs` compiler); the build-time-only packages sit in
   `devDependencies`, keeping `npm install @bgforge/mls-server` lean. The record of what is bundled
   is the release CycloneDX SBOM, not the manifest. fast-glob's inlined fdir carries a guarded
   `require.resolve("picomatch")` that no-ops (try/catch) when picomatch is absent, so the lean
   install still runs - verified by packing the tarball and running its bin against an
   initialize + workspace-scan handshake in an esbuild-wasm-only environment.

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
  +-> Register commands (compile, dialog editor)
  +-> Register the IE game resource viewer (sidebar tree, bgforge-ie-resource: FileSystemProvider, commands)
  |     First, because it owns the game session the binary editor resolves strrefs and IDS names through.
  |     Opening the last-used game is deferred until the view is actually shown - it is synchronous and
  |     proportional to the install, so an activation triggered by a script file must not pay for it.
  +-> Register binary editor provider (.pro/.map/.itm/.spl/.eff/.cre files)
  +-> Register the animation editor (.frm/.bam files)
  +-> Register the Dialog Editor custom editor (.d/.ssl/.td/.tssl)
  +-> Start server (server/out/server.js)
```

**VSCode engine floor (1.91):** The extension declares `engines.vscode: ^1.91.0`
(`package.json`, mirrored by `client/package.json` `engines` and `@types/vscode`).
The floor was raised from 1.73 to 1.91 when the LSP stack moved to
`vscode-languageclient` / `vscode-languageserver` 10.x (protocol 3.18.2):
`vscode-languageclient@10.1.0` itself declares `engines.vscode: ^1.91.0`, and the
`createOutputChannel(name, { log: true })` LogOutputChannel API the 10.x client
requires arrived in 1.74 - both well above the older `vscode.CustomEditorProvider`
(1.46) and `semanticTokenTypes` (1.43) contributions. Raise it further only if a
feature requiring a later release is added.

### TypeScript Language Service Plugins

Plugins intercept tsserver calls for transpiler files. They run inside the tsserver
process, not the extension host.

- **TSSL Plugin** - suppresses TS6133 for engine procedures, adds hover docs. See [plugins/tssl-plugin/README.md](../plugins/tssl-plugin/README.md).
- **TD Plugin** - injects `td-runtime.d.ts`, filters completions per file type. See [plugins/td-plugin/README.md](../plugins/td-plugin/README.md).

### Webview Panels

Two webview-based features, each with a host-side and browser-side module:

| Feature       | Host Module                            | Webview Module                             | Trigger                                            |
| ------------- | -------------------------------------- | ------------------------------------------ | -------------------------------------------------- |
| Dialog Editor | `client/src/dialog-editor/panel.ts`    | `client/src/dialog-editor/webview/main.ts` | Ctrl+Shift+V (or Reopen With) on .d/.ssl/.td/.tssl |
| Binary Editor | `client/src/binary-editor/provider.ts` | `client/src/binary-editor/webview/main.ts` | Open .pro/.map/.itm/.spl/.eff/.cre                 |

The Dialog Editor is a `CustomTextEditorProvider` (viewType `bgforge.dialogEditor`), not a standalone panel: it edits the underlying `.d`/`.ssl`/`.td`/`.tssl` source, round-tripping changes through the server. Its host side is split into `panel.ts` (the vscode/webview boundary - `asWebviewUri`, nonce generation, the cached bundle read), `host-core.ts` (a vscode-agnostic `DialogHostCore` for unit testing), and `dialog-webview-html.ts` (pure CSP + HTML construction). The webview is a Svelte app (`webview/main.ts` -> `App.svelte`) rendering the conversation graph via `@xyflow/svelte`.

For the binary library internals - spec system, primitives, derivation, format-adapter pattern, adding a new format - see [binary/INTERNALS.md](../binary/INTERNALS.md).

#### Webview CSP: styles need `cspSource`, not a bare nonce

Both webviews lock the inline `<script>` bundle to a per-load CSP nonce (`script-src 'nonce-...'`). Styles are
different: a webview's `style-src` **must include `{{cspSource}}`**. VS Code wraps the webview in its own CSP layer
and only honours `style-src` sources it can attribute to the webview origin (`cspSource`); a `style-src 'nonce-...'`
with no `cspSource` is honoured by raw Chromium - so it passes any headless or standalone render - but is silently
dropped by the wrapped VS Code webview. The symptom is a fully unstyled panel (default user-agent buttons, no theme
colors) while the nonce'd script still runs, so the editor looks live but flat. The CSP shapes are pinned by
`client/test/webview-csp.test.ts` as a regression guard.

- `binary-editor/webview/index.html`: `style-src {{cspSource}}`; `styles.css` and `codicon.css` load as
  `webview.asWebviewUri()` `<link>` elements (the documented custom-editor pattern). Both `client/src/binary-editor/webview`
  and `client/out/codicons` are in the panel's `localResourceRoots`. Because codicon.css links directly, its
  `@font-face` `url("./codicon.ttf")` resolves relative to the stylesheet URI - no font-URL rewrite is needed.
- `dialog-editor` (`dialog-webview-html.ts`): `style-src {{cspSource}} 'unsafe-inline'`; the CSS loads as a
  `webview.asWebviewUri()` `<link>` and the Svelte bundle inlines as a nonce'd `<script>`. Here `'unsafe-inline'`
  (not just `cspSource`) is required because Svelte Flow (`@xyflow/svelte`) positions nodes via runtime inline
  `transform` styles - a nonce-only style policy would drop them and the nodes would stack at the origin.

Binary editor design choice:

- `.map` files are parsed strictly in the custom editor. If strict parsing fails, the editor shows the parse errors instead of silently falling back to heuristic recovery.
- Graceful MAP fallback remains available in non-editor workflows such as the binary CLI via `--graceful-map`, where corpus parsing and opaque-byte round-tripping are more useful than an editable strict tree.
- The editor includes `Dump to JSON` and `Load from JSON` sidebar actions. Snapshots use extension-preserving sidecars such as `file.pro.json` and `file.map.json`.
- Binary JSON snapshots are canonical `schemaVersion: 1` documents for both `pro` and `map`. They are validated on dump and load. Legacy editor-tree snapshots are no longer supported.
- Both binary parsers now separate canonical data from presentation. Parser results still include a tree for the editor, but `ParseResult.document` is the canonical machine model and is the source of truth for JSON dump/load and binary serialization.
- Canonical rebuild during save and JSON export is strict about output validity. If a parsed PRO or MAP field is outside a supported domain range, the serializer clamps it to the nearest valid value before writing bytes or snapshots.
- Presentation metadata such as labels, enum/flag option tables, numeric formatting, and editability is defined separately in `binary/src/presentation-schema.ts`, so external tools can consume the canonical data contract without inheriting the editor tree.
- Presentation lookups are keyed by stable semantic IDs such as `pro.header.objectType` and `map.scripts[].extents[].slots[].flags`. The old escaped tree-path lookup form is no longer part of the contract.

##### Declarative layout layer (render-path branch)

The per-format editor UI can be described by **data** rather than by the parser's group tree. A format's `BinaryFormatAdapter` may carry an optional `layout: FormatLayout` (`binary/src/layout-schema-types.ts`, zod-validated) - a set of variants (chosen by the parse result's `variantId`), each a list of rows of panels, each panel a stack of blocks: `fields` (label+control list), `flags` (one flags field as N checkbox columns), `matrix` (Base|Bonus-style 2D table), `grid` (N-column cells), plus `list`/`raw` (stubs for the follow-up). Fields are referenced by semantic field key (the same `toSemanticFieldKey` keys presentation uses), so the view is decoupled from byte order and parser grouping.

When an adapter declares a `layout` and the parse result reports a matching `variantId`, `binary-editor/buildLayout` returns a `ResolvedLayout` (the variant's rows + a `FieldRef -> Row` map) and the webview renders it via `LayoutRenderer` (`webview/components/LayoutRenderer.svelte` + the per-block components) - a single dense page, no section tabs. Otherwise the legacy depth-0-groups-as-tabs path renders unchanged. The two paths coexist; `App.svelte` branches on `open.layout.layout`.

**PRO critters** were the first format migrated: a critter's ~90 fields render as a single page (Header + flag columns, Demographics, Final, a Stats matrix, a Skills grid) instead of 13 tabs. A `layout-schema.ts` is now authored for the six field-form formats (`pro`, `map`, `itm`, `spl`, `eff`, `cre`); DLG has none, since it renders in the dialog editor rather than the field form. Within PRO, only the critter variant is authored - other PRO object/sub types report a `variantId` with no matching variant and fall back to the tabs path. The parser stays a faithful bytes<->model mapping; all grouping/placement is presentation data in `<format>/layout-schema.ts`.

- MAP JSON snapshots remain fidelity snapshots. Any MAP region the editor intentionally omits from the visible tree, such as tiles or opaque tails, is still carried in the canonical snapshot so JSON round-trips remain byte-preserving.
- That byte preservation applies to omitted MAP regions and preserved fixed-width source bytes such as filename slots. Once a field is modeled and changed through the canonical document, JSON load/save treats the parsed value as authoritative and rewrites that field in canonical form.
- MAP snapshots are semantic documents, not field-layout dumps. Regular decoded MAP fields do not persist `offset`, `size`, `valueType`, or `nodeType`; those remain internal codec concerns. Offsets and sizes are only preserved in `opaqueRanges` for undecoded or intentionally omitted byte spans.
- MAP snapshots use a single persisted tile encoding: tile bytes must be stored in the `opaqueRanges` entry labeled `tiles`. Decoded tile snapshots are intentionally unsupported.
- JSON load in the custom editor intentionally stays strict for MAP files even when a snapshot was originally produced from a graceful parse. This is on purpose: ambiguous MAP bytes should not spread through normal editor workflows. Users who explicitly want to reload those ambiguous snapshots must use the binary CLI with `--graceful-map`.
- The custom editor intentionally omits MAP tile data. Tiles are large, mostly low-signal bulk data for editor workflows, so the editor skips materializing them entirely and preserves their bytes only for round-trip save/revert.
- The MAP editor hides a few script-entry struct slots that Fallout 2 CE still leaves as legacy or unknown internals. It keeps meaningful fields visible, renames them to match CE semantics where possible, and leaves the persisted program pointer slot read-only because the engine treats the saved pointer value as non-semantic.
- The editor sends a lazy tree model to the webview rather than one large pre-expanded JSON payload. Enum/flag choices are attached per field node, and MAP projection now lives in the tree builder instead of a separate compacted parse-result layer.
- Format-specific behaviour (snapshots, canonical rebuild, semantic key mapping, editor projection, structural edits) is encapsulated in `BinaryFormatAdapter` implementations registered in `binary/src/format-adapter.ts`. Adding a new binary format requires implementing this interface alongside the parser.
- The Dialog Editor and binary editor share the same inline webview asset helper (`client/src/webview-assets.ts`) for HTML/CSS/JS shell loading.

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
`Partial<>` intersection of all capabilities - providers declare explicit `implements` clauses
for compile-time enforcement:

| Provider         | Completion | Hover | Signature | Definition | References | Format | Symbols | Workspace Symbols | Rename | Inlay | Folding | Diagnostics | JSDoc |
| ---------------- | :--------: | :---: | :-------: | :--------: | :--------: | :----: | :-----: | :---------------: | :----: | :---: | :-----: | :---------: | :---: |
| fallout-ssl      |     x      |   x   |     x     |     x      |     x      |   x    |    x    |         x         |   x    | .msg  |    x    |    sslc     |   x   |
| fallout-worldmap |     x      |   x   |           |            |            |        |         |                   |        |       |         |             |       |
| infinity-2da     |            |       |           |            |            |   x    |         |                   |        |       |         |             |       |
| weidu-baf        |     x      |   x   |           |            |            |   x    |         |                   |        | .tra  |    x    |    weidu    |       |
| weidu-d          |     x      |   x   |           |     x      |     x      |   x    |    x    |         x         |   x    | .tra  |    x    |    weidu    |   x   |
| weidu-log        |            |       |           |     x      |            |        |         |                   |        |       |         |             |       |
| weidu-tp2        |     x      |   x   |           |     x      |     x      |   x    |    x    |         x         |   x    | .tra  |    x    |    weidu    |   x   |

`infinity-2da` also provides semantic-token (zebra-grid) highlighting for `.2da` files, a capability the
matrix above does not track as a column.

### Transpilers

Two TypeScript-to-scripting-language transpilers share a common pipeline (TSSL emits INT bytecode rather
than source, and lives under `compilers/`):

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

The four internal packages (`common`, `tssl`, `tbaf`, `td`) stay private. The
publishable library lives at the `transpilers/` root as `@bgforge/transpile`
and bundles all four into a single ESM artifact via `tsdown`. Internal consumers
(LSP server, TS plugins) keep importing the per-language packages directly;
external consumers use the bundled library. `esbuild-wasm` is the only runtime
dependency - it cannot be inlined because it detects bundling at load time.

**Shared pipeline** (`transpilers/common/transpiler-pipeline.ts`): `createTranspiler()` factory
handles the common orchestration - extension validation, @tra tag extraction, file I/O,
and structured compile events such as `output_written`. The shared pipeline does not
write to stdout; host-specific callers decide whether to surface those events as LSP
messages, CLI stderr output, or ignore them. TBAF and TD use this factory; TSSL has
custom entry points due to its batch state and non-standard output path.

**Shared utilities** (`transpilers/common/transpiler-utils.ts`): variable substitution, loop unrolling
(max 1000 iterations), array spread/destructuring, helper fixups (obj/tra/tlk),
point tuple conversion (`[x, y]` -> `[x.y]`), @tra tag extraction.

**Shared bundler** (`transpilers/common/bundle.ts`): esbuild-wasm with externalized `.d.ts` imports,
enum transformation plugin, extensionless import resolution. Used by TBAF and TD
directly; TSSL calls `bundleWithEsbuild()` directly with preserved-function tracking.
TBAF/TD skip bundling for import-free files (`hasImports()` guard); TSSL always bundles
because enums are a first-class feature, inline function extraction depends on bundling,
and enum property expansion needs all bundled enum names.

**Architecture differences**: TBAF uses a
structured IR (`BAFBlock/Condition/Action`) with condition algebra (boolean to
CNF conversion for BAF OR groups). TD has the richest IR (20+ construct types)
with state machines, method chain parsing, and dual-pass orphan detection.

| Transpiler | Input   | Output | Key Features                                                                                                 |
| ---------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| TBAF       | `.tbaf` | `.baf` | for/for-of, arrays, spread, destructuring, function inlining, point tuples                                   |
| TD         | `.td`   | `.d`   | All TBAF features + conditionals, method chains, transitive state collection, orphan warnings, dialog editor |

**TD module structure** (`transpilers/td/src/`):

| Module                 | Purpose                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `index.ts`             | Entry point, bundling, orphan detection on original source |
| `parse.ts`             | AST walker: ts-morph AST -> IR                             |
| `parse-helpers.ts`     | Utility functions (evaluate, resolve, validate)            |
| `parse-constructs.ts`  | Top-level construct dispatch (states, dialogs, patch ops)  |
| `parse-chain.ts`       | Per-construct method-chain entry parsing                   |
| `expression-eval.ts`   | Expression -> trigger/action/text conversion               |
| `chain-parsing.ts`     | Method chain transition parsing                            |
| `chain-processing.ts`  | Chain body processing (from/fromWhen/say)                  |
| `transition-calls.ts`  | Transition call-site collection across chains              |
| `state-transitions.ts` | State/transition processing, loop unrolling                |
| `state-resolution.ts`  | Post-parse BFS transitive collection, orphan detection     |
| `inline-and-unroll.ts` | Inline-function and loop-unroll expansion before emit      |
| `patch-operations.ts`  | Patch operation transforms (ALTER_TRANS, etc.)             |
| `emit.ts`              | IR -> D text serialization                                 |
| `types.ts`             | IR types (TDScript, TDConstruct, TDState, TDSay, etc.)     |
| `td-runtime.d.ts`      | TypeScript declarations for TD API                         |

`dialog.ts` (the Dialog Editor's server-side parse, `parseDialog`) lives in `server/src/` - it depends on tree-sitter parsers and LSP infrastructure and was not extracted.

## CLI Tools

Standalone command-line tools that reuse server modules without VSCode dependency.

### Format CLI

```
fgfmt <file|dir> [--save] [--check] [--save-and-check] [--check-idempotency] [-r] [-q]
```

Formats Fallout SSL, WeiDU BAF/D/TP2, WeiDU TRA, Fallout MSG, Infinity Engine 2DA, and
Fallout scripts.lst files. Parser-based formats (SSL/BAF/D/TP2) use tree-sitter and
respect `.editorconfig`. String-based formats (TRA/MSG/2DA/scripts.lst) require no parser.
Includes WASM parser modules. Ships as the `fgfmt` bin entry in `@bgforge/format`; the
library entry exposes the formatters for use in custom build pipelines.

### Transpile CLI

```bash
fgtp <file.td|file.tbaf|dir> [--save] [--check] [-r] [-q]
```

Transpiles `.tbaf` and `.td` files to their target formats; `.tssl` is compiled by the separate `tssl`
CLI in `@bgforge/tssl`. Uses ts-morph
and native esbuild in the standalone CLI build (`--alias:esbuild-wasm=esbuild`).
Reports orphan warnings for TD files.

### Binary CLI

```
fgbin <file.pro|file.map|file.itm|file.spl|file.eff|file.cre|file.dlg|dir> [--save] [--check] [--load] [--graceful-map] [--proto-dir <dir>] [-r] [-q]
```

Ships as the `fgbin` bin entry of `@bgforge/binary` (built via tsdown to `binary/out/cli.js`).

Parses Fallout `.pro` / `.map` and Infinity Engine `.itm` / `.spl` (v1), `.eff` (v2), `.cre` (v1), and `.dlg` (v1) binary files and outputs structured JSON. `--load` writes JSON back using the parser's native extension, and `--graceful-map` allows ambiguous MAP object boundaries to fall back to opaque bytes for corpus and round-trip workflows. `--proto-dir <dir>` overrides where MAP decoding scans for object-subtype protos (`<dir>/{items,scenery}`) when a mod's proto tree is not at the default sibling `<mapDir>/../proto/`.
Snapshots are saved as extension-preserving sidecars such as `file.pro.json`, `file.map.json`, `file.itm.json`, `file.spl.json`, `file.eff.json`, `file.cre.json`, `file.dlg.json`.

### SSL CLI

```
ssl {switches} filename [-o outputname] [filename [..]]
```

Compiles Fallout SSL to INT bytecode. The switches are the reference `sslc` compiler's, so a build script
written for it can call this instead; `compilers/ssl/README.md` lists them and the handful of deliberate differences.
Output is byte-identical to the reference at `-O0`, `-O1` and `-O2`, which the corpus differentials in
`compilers/ssl/test/integration/` hold it to. Ships as the `ssl` bin of the private `@bgforge/ssl` package (tsdown to
`compilers/ssl/out/cli.js`, with the SSL grammar WASM copied beside it), and the same library backs the language
server's `typescript` compiler setting.

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

Six tree-sitter grammars compiled to WASM: 4 back full LSP providers, and 2 (MSG, TRA) are
parsed by the server for parse-error diagnostics and provide highlighting for external editors.
See [grammars/README.md](../grammars/README.md) for the full list, build commands,
WASM rationale, and type generation details.

### TextMate Grammars

TextMate grammars (in `syntaxes/`) provide syntax highlighting. Source is YAML,
converted to JSON at build time. Includes:

- 12 primary language grammars
- 4 tooltip grammars (hover rendering)
- 3 injection grammars (comments, strings, docstrings)
- 1 webview tokenizer grammar (`dialog-tsexpr` - embedded TS-expression highlighting in the dialog
  editor; consumed directly by the webview bundle, not registered in `contributes.grammars`)

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

### Coverage thresholds

Per-package vitest coverage thresholds reflect the slice of behaviour each package's
unit tests are responsible for, not the package's full execution surface. The
authoritative threshold values live in each package's own `vitest.config.ts`
(`coverage.thresholds` block) - this doc intentionally does not restate the numbers,
so they cannot drift out of sync as thresholds are ratcheted. Two packages run
intentionally low floors because their broader behaviour is verified by other layers:

- **`@bgforge/format`** (`format/vitest.config.ts`): the tree-sitter-driven formatters (`src/{fallout-ssl,weidu-baf,weidu-d,weidu-tp2}/`) are exercised end-to-end by grammar-corpus fixtures under `grammars/*/test/corpus/` and by the directory-mode `--check-idempotency` invocation in `scripts/test-external.sh` (run by `pnpm test:all`), so they are excluded from this gate's coverage scope; the threshold measures only the standalone unit slice (the pure formatters, utilities, helpers, dispatch) it actually covers.
- **`@bgforge/transpile`** (`transpilers/vitest.config.ts`): the bulk of transpiler correctness is enforced by the TD/TBAF fixture-driven integration suites in `scripts/test.sh` (`api.test.ts`, `transpile-cli.test.ts`, and the `test/td` + `test/tbaf` fixture suites). The vitest project here covers the public API, shared helpers, and targeted unit slices of the per-language transformers (TBAF condition algebra, TD expression evaluation, TSSL operator conversion, the shared loop-unroll guard); Stryker mutation testing does not reach this package (it mutates `server/src/core` only - see below), so the rest of the per-language transformer surface is exercised through those integration suites.

Stryker (`stryker.conf.json`) mutates exactly three `server/src/core` files -
`normalized-uri.ts`, `symbol-index.ts`, and `provider-registry.ts` - not the
transpilers or any other package. The `break` threshold sits at 70 (`high` 80,
`low` 70); run `pnpm exec stryker run` locally for the current per-file scoped
score (report at `tmp/mutation/report.html`), since the figure moves as those
files' tests change and a snapshot pinned to one run's date would go stale here
the same way the coverage numbers above did.

The other workspaces - `server`, `client`, `binary`, `shared`, `scripts`, and the
two TypeScript plugins - run substantially higher floors (see each package's own
`vitest.config.ts`) because their unit suites are responsible for the bulk of
their own behaviour. `server`
additionally excludes `src/fallout-ssl/provider.ts` and `src/weidu-tp2/provider.ts`
(LSP dispatcher glue verified by the integration tests under `server/test/integration/`)
and `src/**/format/**/*.ts` (per-language tree-sitter formatters covered by
grammar-corpus tests).

Ratchet upward when the unit slice in any package widens.

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

The threshold is a per-request, per-call budget - not an aggregate. A single request that
takes longer than 50 ms triggers a warning regardless of prior request history.

Every request-handler module under `server/src/handlers/` that serves an interactive request wraps its
work in `timeHandler`: completion, hover, definition, references, symbols (document and workspace),
semantic tokens, formatting, rename, folding, selection range, call hierarchy, document lifecycle,
config, and execute-command.

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
(including 0.x -> 0.y where y > current, which npm treats as breaking) are deferred
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
(`.oxlint/oxlint-plugin-no-showmessage.mjs`) enforces this -- direct
`connection.window.show*Message()` calls in server code produce lint errors.
Debug logs intentionally keep raw URIs to preserve diagnostic ability.

## Deliberate Non-Consolidations

Cases where apparent duplication is intentional. Each subsection explains why the
components stay separate.

### Five Separate CLIs (format, transpile, binary, ssl, tssl)

`format/` (fgfmt bin), `transpilers/` (fgtp bin), `binary/` (fgbin bin), `compilers/ssl/` (`ssl` bin) and
`compilers/tssl/` (`tssl` bin) stay as separate bundles.
Shared scaffolding (argument parsing, file discovery, output modes) is already extracted to
`shared/cli/cli-utils.ts`; further consolidation was evaluated and costs more than it saves.

- The transpile bundle is ~12 MB (owns `esbuild` + `ts-morph` + transform passes). Format
  and binary bundles are small. A unified binary would load the transpile toolchain on every
  `format` or `binary` invocation -- cold-start and install-size regression for the two use
  cases that don't need it.
- The tools do semantically different jobs: text round-trip, source-to-source
  transpilation, bytecode compilation, binary parsing. The shared surface is already shared at the right layer
  (`shared/cli/cli-utils.ts`); the per-tool bodies are not duplicated.
- The format CLI ships as the `fgfmt` bin entry within `@bgforge/format`, the transpile
  CLI ships as the `fgtp` bin entry within `@bgforge/transpile`, and the binary CLI ships
  as the `fgbin` bin entry within `@bgforge/binary` -- each library and its CLI share one
  package, one version, and one tarball without coupling to the other tools.
- The `ssl` CLI is the one that does not use `shared/cli/cli-utils.ts`. Its argument grammar is the
  reference SSL compiler's rather than this repo's `--save`/`--check` convention, so that a build script
  written for that compiler can call it unchanged; sharing the parser would mean parameterising it into
  two unrelated grammars. Its own parser lives in `compilers/ssl/src/args.ts` and is shared with the language
  server, which reads the same command line out of the `compileOptions` setting.

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
