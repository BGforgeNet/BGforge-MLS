# Architecture

See also: [development.md](development.md) | [server/INTERNALS.md](../server/INTERNALS.md) |
[scripts/README.md](../scripts/README.md)

The shape of the BGforge MLS extension for a contributor orienting in the codebase: which processes and threads
run, which packages exist and how they reach each other, where the boundaries between them sit, and the
system-level decisions behind that. Module-level detail lives beside the code - in module header comments and in
the package docs linked below - so this page names each piece and points there.

## Table of Contents

- [System Overview](#system-overview)
  - [Processes](#processes)
  - [Worker threads](#worker-threads)
  - [External processes](#external-processes)
  - [The standalone server](#the-standalone-server)
- [Repository Layout](#repository-layout)
- [Package Dependencies](#package-dependencies)
- [Boundaries](#boundaries)
  - [Client and server](#client-and-server)
  - [Extension host and webviews](#extension-host-and-webviews)
  - [Game installs](#game-installs)
  - [Custom URI schemes](#custom-uri-schemes)
- [Compilers and Transpilers](#compilers-and-transpilers)
- [CLI Tools](#cli-tools)
- [Grammars and Data](#grammars-and-data)
- [Build](#build)
- [Tests](#tests)
- [Packaging](#packaging)
- [Key Design Decisions](#key-design-decisions)
- [Deliberate Non-Consolidations](#deliberate-non-consolidations)

## System Overview

```
+--------------------------------------+   LSP over IPC    +--------------------------------+
| VS Code extension host               | <---------------> | LSP server (server/)           |
|   client/src/extension.ts            |                   |   handlers -> ProviderRegistry |
|   custom editors, panels, FS         |                   |   -> per-language providers    |
|   providers, in-process libraries    |                   |   worker threads               |
|   worker threads                     |                   |   spawns: WeiDU, sslc, esbuild |
+--------------------------------------+                   +--------------------------------+
     |                   |                                         |
     | postMessage       | reads, writes override/                 | reads
     v                   v                                         v
+-----------------------------+   +--------------------------------------------------------+
| Webviews (Svelte): binary   |   | Game install (chitin.key, BIFs, dialog.tlk, override/) |
| editor, dialog editor,      |   +--------------------------------------------------------+
| animation editor, gallery   |
+-----------------------------+

+--------------------------------------+
| tsserver (VS Code's TypeScript)      |
|   bgforge-tssl-plugin                |
|   bgforge-td-plugin                  |
+--------------------------------------+
```

### Processes

1. **Extension host** - `activate()` in `client/src/extension.ts` registers the editors, panels and file system
   providers and starts the language client. The IE game resource viewer registers first, because it owns the
   game session the binary editor, the animation editor and the gallery resolve names and resources through.
   What activates the extension is `activationEvents` in `package.json`.
2. **LSP server** - `server/out/server.js`, started by the language client over IPC. Language features,
   diagnostics, compilation and the dialog editor's source parse. See [server/INTERNALS.md](../server/INTERNALS.md).
3. **tsserver** - VS Code's own TypeScript server loads the two TS Language Service plugins for `.tssl` and `.td`
   files. They run inside tsserver, not the extension host.

The extension host is not a thin client: it runs libraries and compilers in-process. The binary editor
(`@bgforge/binary-editor`, `@bgforge/binary`), the animation editor and gallery (`@bgforge/image`,
`@bgforge/animation`), the compiled-script views (`compilers/ssl` in `client/src/int-editor/`, `compilers/bcs` in
`client/src/bcs-editor/`, web-tree-sitter in `client/src/script-view/parser.ts`) and the `.dlg` dialog editor
(`@bgforge/binary`) all do their work there, without the server.

### Worker threads

Synchronous CPU-heavy work runs off the main threads:

| Worker                                                 | Started from                                 | Work                                                  |
| ------------------------------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| `client/src/binary-editor/worker.ts`                   | `client/src/binary-editor/document.ts`       | Parsing and editing one open binary file              |
| `client/src/gallery/worker.ts`                         | `client/src/gallery/panel.ts`                | Archive reads, decodes and thumbnails                 |
| ELK layout worker (blob URL, in the webview)           | `client/src/dialog-editor/webview/layout.ts` | Dialog graph layout                                   |
| `server/src/worker/ts-morph-worker.ts` (two instances) | `server/src/worker/worker-client.ts`         | TSSL compile; TD/TBAF transpile; TD/TSSL dialog parse |
| `server/src/fallout-ssl/compile-worker.ts`             | `server/src/worker/worker-client.ts`         | The extension's own SSL compiler                      |
| `compilers/ssl/src/cli-worker.ts` (a pool)             | `compilers/ssl/src/cli-pool.ts`              | `ssl` CLI compiles, one input per worker              |

### External processes

The server spawns every external program; the extension host spawns none.

- **WeiDU** - parse-checks BAF, D and TP2 (`server/src/weidu-compile.ts`).
- **An external `sslc`/`compile.exe`** named by `bgforge.falloutSSL.compilePath` (`server/src/fallout-ssl/compiler.ts`).
- **The reference `sslc` built to WebAssembly** - forked as a Node child process (`server/src/sslc/ssl_compiler.ts`).
- **esbuild** - `esbuild-wasm` runs its binary in a `node` child process, started from the transpile worker; the
  runtime it uses is pinned in `transpilers/common/node-runtime.ts`.

WeiDU and external compiler runs go through `server/src/process-runner.ts`.

### The standalone server

The server is also published on its own as `@bgforge/mls-server`, with a `bgforge-mls-server` bin, for other
editors - see [server/README.md](../server/README.md) and the per-editor guides in [editors/](editors/README.md).
Everything it offers travels over standard LSP methods, so nothing it does depends on the VS Code client.

## Repository Layout

Top-level directories. Where a package has its own README, `AGENTS.md` or `INTERNALS.md`, that describes its
modules.

| Directory                            | Contents                                                                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `client/`                            | VS Code extension client: one directory per feature under `client/src/`, each with a `webview/` where it has a UI                          |
| `server/`                            | LSP server - see [server/INTERNALS.md](../server/INTERNALS.md); `server/data/` holds the YAML engine data                                  |
| `binary/`                            | `@bgforge/binary`: binary format parsers, the game archive layer, `fgbin` - see [binary/INTERNALS.md](../binary/INTERNALS.md)              |
| `binary-editor/`                     | `@bgforge/binary-editor`: layout layer between parsed records and the editor webview - see [AGENTS.md](../binary-editor/AGENTS.md)         |
| `format/`                            | `@bgforge/format`: formatters + `fgfmt` - see [format/README.md](../format/README.md)                                                      |
| `image/`                             | `@bgforge/image`: FRM/BAM codecs, palettes, PNG import/export - see [image/README.md](../image/README.md)                                  |
| `animation/`                         | `@bgforge/animation`: IE animation-set resolution and conversion - see [animation/README.md](../animation/README.md)                       |
| `compilers/`                         | `ssl`, `tssl`, `bcs` - see [compilers/README.md](../compilers/README.md)                                                                   |
| `transpilers/`                       | `@bgforge/transpile` + `fgtp`, over the private `tbaf`, `td` and `common` packages - see [transpilers/README.md](../transpilers/README.md) |
| `shared/`                            | Pure TypeScript used by several packages: parser management, the dialog model, protocol ids, syntax-type enums, CLI helpers                |
| `plugins/`                           | TypeScript Language Service plugins (`tssl-plugin`, `td-plugin`)                                                                           |
| `grammars/`                          | Tree-sitter grammars - see [grammars/README.md](../grammars/README.md)                                                                     |
| `syntaxes/`                          | TextMate grammars - see [syntaxes/README.md](../syntaxes/README.md)                                                                        |
| `editors/`                           | Hand-written editor syntax inputs, merged with generated output by `scripts/build-editors.sh`                                              |
| `language-configurations/`           | VS Code language settings (brackets, comments, indent)                                                                                     |
| `themes/`, `snippets/`, `resources/` | Colour and icon themes, code snippets, extension icon                                                                                      |
| `scripts/`                           | Build, test and data-generation scripts - see [scripts/README.md](../scripts/README.md)                                                    |
| `actions/`                           | Reusable composite GitHub Actions - see [actions/README.md](../actions/README.md)                                                          |
| `external/`                          | Real game and mod files for tests (gitignored, restored by `pnpm test:external`)                                                           |

The feature directories under `client/src/` that shape the rest of this page: `binary-editor/`, `dialog-editor/`
(source dialogs and compiled `.dlg`), `image-editor/` (the animation editor, viewType `bgforge.animationEditor`),
`gallery/` (a webview panel rather than a custom editor), `ie-resources/` (the game resource viewer and its file
system provider), and `script-view/` with `int-editor/` and `bcs-editor/` (compiled scripts opened as source).
Shared webview components and stylesheets are in `client/src/webview-ui/`; the editors' UI conventions are in
[binary-editor-ui.md](binary-editor-ui.md).

## Package Dependencies

```
client ------> binary-editor ---> binary
   |---------> binary, image, animation ---> image
   |---------> compilers/ssl, compilers/bcs              (relative source imports)

server ------> format, binary/archive                    (tsconfig paths)
   |---------> compilers/ssl, compilers/tssl,
   |           compilers/bcs, transpilers                (relative source imports)

compilers/tssl --> compilers/ssl, transpilers/common,
                   server/out/*.json                     (generated data)
transpilers ----> transpilers/tbaf, transpilers/td, transpilers/common
plugins/tssl-plugin --> server/out/*.json                (generated data)
plugins/td-plugin ....> server/out/td-runtime.d.ts       (read at run time)

nearly every package --> shared/
```

Packages reach each other three ways, and none of them goes through another package's bundle:

- **tsconfig `paths` to the sibling's `src/`**, which esbuild honours: `client/tsconfig.json` maps `@bgforge/binary`,
  `@bgforge/image` and `@bgforge/animation`; `server/tsconfig.json` maps `@bgforge/format` and
  `@bgforge/binary/archive`. `@bgforge/binary-editor` is a workspace dependency whose `main` is its source.
- **Relative source imports** across the tree, whether or not the target package has an entry of its own - the
  server reaching `transpilers/src/`, `compilers/tssl/src/` and `compilers/ssl/src/`, the client reaching
  `compilers/ssl/src/` and `compilers/bcs/src/`, everything reaching `shared/`.
- **Build outputs as inputs**: the TS plugins and `compilers/tssl` import JSON that `scripts/generate-data.sh` writes
  into `server/out/`, and `td-plugin` finds `td-runtime.d.ts`, which the server build copies there, by path at run
  time. The data generation has to run before those builds.

## Boundaries

### Client and server

Every custom operation between the extension and the server is a standard `workspace/executeCommand`; neither side
registers a custom request or notification. The command ids are in `shared/protocol.ts` and the wire contract is
[lsp-api.md](lsp-api.md). The client uses them for compile, the dialog editor's parse and translation save, and
language-scoped workspace symbol search.

The dialog editor over a source file (`.d`, `.ssl`, `.td`, `.tssl`) is the one feature split across both sides:

1. The server parses the document (`bgforge.parseDialog`) and returns the dialog tree with its translation strings.
2. The client maps it into the format-neutral model, and on an edit serializes the change with the
   `shared/dialog-*` modules and applies it to the live document as a `WorkspaceEdit`, so VS Code owns dirty
   state, undo and save.
3. The edited document re-syncs to the server and the client parses again; edited `@N` strings are persisted
   through `bgforge.saveDialogTra`.

`client/src/dialog-editor/panel.ts` binds this to VS Code, `host-core.ts` is the host-agnostic session and
`dialog-source-edit.ts` picks the per-language edit module. A compiled `.dlg` never reaches the server:
`client/src/dialog-editor/dlg-panel.ts` reads and writes it through `@bgforge/binary` and feeds the same webview.

### Extension host and webviews

Each webview talks to its host through `postMessage` with a typed message union, one per UI:
`client/src/<feature>/webview/messages.ts`. The binary editor has a second protocol behind its host, the requests
its worker answers (`binary-editor/src/protocol.ts`).

Webview CSP: stylesheets load as `webview.asWebviewUri()` links authorised by `style-src {{cspSource}}`, never as
nonce-only styles - why, and what breaks otherwise, is in the header of `client/src/webview-html.ts`. The dialog
editor's wider policy is commented in `client/src/dialog-editor/dialog-webview-html.ts`.

### Game installs

`@bgforge/binary`'s archive layer (`binary/src/archive/`) reads an Infinity Engine install: the KEY/BIF resource
namespace, TLK string tables, 2DA and IDS tables, opened through `openGame()`. Two processes open an install
independently, both from `bgforge.weidu.gamePath`:

- the extension host (`client/src/ie-resources/current-game.ts`), for the resource viewer, the editors and the
  gallery;
- the server (`server/src/ie-resources/configured-game.ts`), for strref hovers and inlay hints and IDS names, so
  resolution works in any LSP client.

Saves to game resources always land in the install's `override/` folder, never in a BIF
(`client/src/ie-resources/fs-provider.ts`).

### Custom URI schemes

- `bgforge-ie-resource:` - a resource inside the open game, served by the file system provider above
  (`client/src/ie-resources/uri.ts`).
- `bgforge-script:` - a compiled script (`.int`, `.bcs`) served as editable source: reading decompiles, writing
  compiles back over the compiled file (`client/src/script-view/formats.ts`, `filesystem.ts` beside it). The
  language client attaches to this scheme too, so completion and hover work in these views.

## Compilers and Transpilers

[compilers/README.md](../compilers/README.md) covers the compilers: `ssl` (Fallout SSL to INT, byte-identical to
the reference `sslc`), `tssl` (a TypeScript subset compiled straight to INT through the same back end - a
compiler, not a transpiler) and `bcs` (Infinity Engine compiled scripts to and from BAF).
[transpilers/README.md](../transpilers/README.md) covers the TypeScript-to-source transpilers, TBAF and TD.

The internal packages under `transpilers/` stay private; the `@bgforge/transpile` library at the `transpilers/`
root bundles them via tsdown, and TSSL ships separately as `@bgforge/tssl`. The server imports the library's root
entry (`server/src/transpile/transpile-worker.ts`), on a worker thread, and reaches `compilers/tssl` and
`compilers/ssl` by source path. Among the library's runtime dependencies, `esbuild-wasm` is the one that must
stay external: it detects bundling at load time.

The dialog editor's server-side parses live in the server rather than a compiler or transpiler package: the SSL and
D parses (`server/src/dialog.ts`, `server/src/weidu-d/dialog.ts`) run on the server's tree-sitter parsers, and the
TD and TSSL parses (`server/src/td/dialog-source.ts`, `server/src/tssl/dialog-source.ts`) on ts-morph in the
transpile worker.

## CLI Tools

Standalone command-line tools with no VS Code dependency. Each is a bin of the library package it belongs to, and
that package's README is the reference for usage and flags.

### Format CLI

`fgfmt`, in `@bgforge/format` - see [format/README.md](../format/README.md).

### Transpile CLI

`fgtp`, in `@bgforge/transpile` - see [transpilers/README.md](../transpilers/README.md).

### Binary CLI

`fgbin`, in `@bgforge/binary` - see [binary/README.md](../binary/README.md).

### SSL and TSSL CLIs

`ssl` in `@bgforge/ssl` and `tssl` in `@bgforge/tssl` - see [compilers/README.md](../compilers/README.md). `ssl` is
internal and unpublished; `tssl` is published.

## Grammars and Data

### Tree-Sitter Grammars

Tree-sitter grammars compiled to WASM back the full LSP providers; the diagnostics-only ones (MSG, TRA) are parsed
for parse-error diagnostics and provide highlighting for external editors. See
[grammars/README.md](../grammars/README.md) for the list, build commands, WASM rationale and type generation.

### TextMate Grammars

TextMate grammars (in `syntaxes/`) provide syntax highlighting: primary language grammars, tooltip grammars for
hover rendering, injection grammars for comments, strings and docstrings, and a webview tokenizer grammar consumed
directly by the dialog editor bundle rather than registered in `contributes.grammars`. Source is YAML, converted to
JSON at build time - see [syntaxes/README.md](../syntaxes/README.md).

### Engine data

Engine definitions flow from YAML in `server/data/` to JSON in `server/out/` at build time, which the server loads
at startup and the TS plugins bundle. See [data-pipeline.md](data-pipeline.md).

## Build

The monorepo uses **pnpm workspaces**. Two bundlers, split by what is being built:

- **esbuild** builds the extension itself: the client (`scripts/build-base-client.sh`), the server and its workers
  (`scripts/build-base-server.sh`), the TS plugins (`scripts/build-ts-plugin.sh`), the webviews
  (`scripts/build-webviews.mjs`) and the E2E test bundle (`scripts/build-test.sh`).
- **tsdown** builds the library packages that have an `out/` artifact - each one with a `tsdown.config.ts`, which is
  the record of its entries and output.

The extension bundles consume every workspace package from source (see [Package Dependencies](#package-dependencies)),
so no extension bundle waits on a library's `out/`. `pnpm build` (`scripts/build-packages.sh`, which names each
job) builds the extension bundles and the CLI packages in parallel; `pnpm build:all` adds the grammars before it
and the external-editor bundles after it; `pnpm build:dev` is the minimal build for F5 development. The exact
composition is the `build*` scripts in `package.json`.

Constraints that shape the build, each explained where it is enforced:

- **TS plugins are standalone CJS bundles in `node_modules/`**, because tsserver loads them by package name from
  `contributes.typescriptServerPlugins` - `scripts/build-ts-plugin.sh`. Why their `module` settings differ from
  the base config is commented in each plugin's `tsconfig.json`.
- **`SyntaxType` is a runtime module**, not a `.d.ts` enum, so every bundler keeps its values; its home is
  `shared/syntax-types/<grammar>.ts` - see [grammars/README.md](../grammars/README.md) (Type Generation).
- **web-tree-sitter's `import.meta.url` is shimmed** in the CJS bundles - `scripts/esbuild-lib.sh`.
- **Transpiler input bundling externalizes `.d.ts` engine declarations**, which is why libraries imported by
  transpiler sources use named re-exports - `transpilers/common/bundle.ts`.
- **The server bundles inline everything but `vscode` and `esbuild-wasm`**; which bundle carries what is commented in
  `scripts/build-base-server.sh`.

`tsc` type-checks only (`noEmit`); esbuild and tsdown emit all production code.

## Tests

Test commands, the tiers and what each one excludes are in [scripts/README.md](../scripts/README.md) and
[development.md](development.md).

## Packaging

`scripts/package.sh` builds the VSIX; its header describes the steps. What ships, and the guards on it, is in
[ignore-files.md](ignore-files.md).

## Key Design Decisions

### LSP + Provider Registry

All language features route through a single LSP server with a provider registry. Providers implement optional
capability interfaces - each language only implements what it supports. This avoids separate servers per language
while keeping providers decoupled. How requests reach a provider: [server/INTERNALS.md](../server/INTERNALS.md).

### Tree-Sitter for Parsing, ts-morph for TypeScript Sources

Tree-sitter (WASM) handles the niche scripting languages - it is fast, error-tolerant and grammar-driven. ts-morph
handles the TypeScript-based languages (TSSL, TBAF, TD) - it provides a full TypeScript AST with type information.

### Standalone CLIs Share the Libraries

The CLIs are bins of the same library packages the extension uses, so there is no second implementation of
formatting, transpiling, parsing or compiling. The binary editor and `fgbin` share one canonical JSON snapshot
format ([binary/INTERNALS.md](../binary/INTERNALS.md)).

### TypeScript Plugins for the TypeScript-Based Languages

`.tssl` and `.td` files are valid TypeScript. TS plugins intercept tsserver to suppress false errors and inject
engine documentation, giving users full TypeScript tooling (type checking, refactoring, go-to-definition) alongside
the compiler and transpiler features. The plugins do not import the compiler or transpiler packages.

### URI Normalization (Gateway Pattern)

On Windows, VS Code and Node's `pathToFileURL()` produce different percent-encodings for the same file (e.g., `%21`
vs `!`, `%3A` vs `:`), so raw URI strings used as Map/Set keys mismatch silently when one file arrives by two
paths. The `NormalizedUri` branded type (`server/src/core/normalized-uri.ts`) canonicalizes `file://` URIs,
`ProviderRegistry` normalizes every URI at the gateway, and storage keyed by URI takes `NormalizedUri`, so an
unnormalized key is a type error.

Dependency pins and the policy for bumping them: [dependencies.md](dependencies.md).

## Deliberate Non-Consolidations

Cases where apparent duplication is intentional. Each subsection explains why the components stay separate.

### Separate CLIs

`fgfmt`, `fgtp`, `fgbin`, `ssl` and `tssl` stay separate bundles, each built from its own library package; the
published ones ship one package, one version and one tarball per tool. Shared scaffolding (argument parsing, file
discovery, output modes) is already extracted to `shared/cli/cli-utils.ts`; further consolidation was evaluated and
costs more than it saves.

- The transpile bundle inlines ts-morph and drives a bundler, and the TSSL package depends on ts-morph at run time;
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

The plugins stay in separate packages. They intercept different tsserver methods and have different initialization
side effects; merging is mechanically feasible but not worthwhile.

- **tssl-plugin** proxies `getSemanticDiagnostics`, `getSuggestionDiagnostics`, and `getQuickInfoAtPosition`;
  scopes by `.tssl` filename. Purely read-side filtering.
- **td-plugin** proxies `getCompletionsAtPosition` and also calls `overrideHost()` for every project it is
  created in, which rewrites the language service host: for a project containing `.td` files it adds the TD
  runtime declarations to the file list and drops the DOM lib from the compiler settings. A host mutation is a
  side effect the read-side tssl-plugin does not have.
- The two plugins are loaded side-by-side by tsserver via `contributes.typescriptServerPlugins` - having them
  separate costs one extra plugin registration entry, nothing else at run time. The build pipeline already calls
  the same `scripts/build-ts-plugin.sh` for both with different args.
