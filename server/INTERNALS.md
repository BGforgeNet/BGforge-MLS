# Server Internals

See also: [docs/development.md](../docs/development.md) | [docs/architecture.md](../docs/architecture.md) |
[scripts/README.md](../scripts/README.md)

Internals of the LSP server, for contributors working in `server/`. How the server fits into the rest of the system
is [docs/architecture.md](../docs/architecture.md); the wire contract for clients is
[docs/lsp-api.md](../docs/lsp-api.md). Module detail lives in each module's header comment, which this page points
at rather than restates.

## Table of Contents

- [Overview](#overview)
- [Directory Map](#directory-map)
- [Startup and Lifecycle](#startup-and-lifecycle)
- [Request Routing](#request-routing)
- [Provider Capabilities](#provider-capabilities)
- [Symbols and Indexes](#symbols-and-indexes)
- [Diagnostics](#diagnostics)
- [Worker Threads](#worker-threads)
- [Translation](#translation)
- [IE Resources and Strrefs](#ie-resources-and-strrefs)
- [Dialog Editor, Server Side](#dialog-editor-server-side)
- [Tree-Sitter Integration](#tree-sitter-integration)
- [Feature Matrix](#feature-matrix)
- [Latency Budgets](#latency-budgets)
- [Testing](#testing)
- [Adding a New Provider](#adding-a-new-provider)

## Overview

```
 LSP client (IPC or stdio)
        |
        v
 src/server.ts ---------- creates the connection, debouncers and HandlerContext; registers handlers
        |
        v
 src/handlers/*.ts ------ one module per LSP method group; each runs its own fallthrough chain
        |          \
        |           +---> ServerContext: translation service, configured game, settings
        v
 ProviderRegistry ------- resolves language id (and alias), normalizes URIs, dispatches
        |
        +--> fallout-ssl  weidu-baf  weidu-d  weidu-tp2           full providers
        +--> fallout-worldmap-txt  weidu-log  infinity-2da        small providers
        +--> weidu-tra  fallout-msg  fallout-scripts-lst          format-only providers
        |    aliases: weidu-slb, weidu-ssl -> weidu-baf
        |
        +--> worker threads: ts-morph (TSSL compile; TD/TBAF transpile; TD/TSSL dialog parse), SSL compile
```

The registered set and the aliases are in `src/handlers/initialize.ts`.

Two conventions hold server-wide:

- **URIs are normalized at the gateway.** `ProviderRegistry` passes every URI through `normalizeUri()`, and storage
  keyed by URI takes the `NormalizedUri` branded type (`src/core/normalized-uri.ts`). Why:
  [docs/architecture.md](../docs/architecture.md#uri-normalization-gateway-pattern).
- **User-visible messages go through `src/user-messages.ts`**, which decodes `file://` URIs into readable paths;
  an oxlint rule (`.oxlint/oxlint-plugin-no-showmessage.mjs`) rejects a direct `connection.window.show*Message()`.
  Debug logs keep raw URIs.

## Directory Map

Directory level only; each module's header says what it does.

| Path                                                                             | Contents                                                                                                                                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/server.ts`                                                                  | Entry point: connection, document manager, debouncers, handler registration, shutdown                                                                                                     |
| `src/handlers/`                                                                  | LSP handlers, plus `context.ts` (the `HandlerContext` every handler receives)                                                                                                             |
| `src/provider-registry.ts`, `src/language-provider.ts`                           | The registry, and the `LanguageProvider` type composed from `src/core/capabilities.ts`                                                                                                    |
| `src/server-context.ts`, `src/lsp-connection.ts`, `src/settings-service.ts`      | Session state holders, populated at startup - see [Startup and Lifecycle](#startup-and-lifecycle)                                                                                         |
| `src/settings.ts`, `src/server-capabilities.ts`                                  | Settings shape and normalization; the capabilities advertised in the initialize response                                                                                                  |
| `src/core/`                                                                      | Symbol and file indexes, static data loading, capability interfaces, language ids, name case, workspace scan and file watching, compile lifecycle helpers                                 |
| `src/shared/`                                                                    | Cross-provider helpers: references index, folding/selection/comment factories, JSDoc, signatures, semantic tokens, formatting edits, syntax diagnostics, parse scheduling, request timing |
| `src/fallout-ssl/`, `src/weidu-baf/`, `src/weidu-d/`, `src/weidu-tp2/`           | Full language providers                                                                                                                                                                   |
| `src/fallout-worldmap/`, `src/weidu-log/`, `src/infinity-2da/`                   | Small providers (worldmap completion and hover, WeiDU.log definition, 2DA tokens and format)                                                                                              |
| `src/compile.ts`, `src/weidu-compile.ts`, `src/sslc/`                            | Compile dispatch, the WeiDU bridge, the WebAssembly `sslc` bridge                                                                                                                         |
| `src/diagnostics.ts`, `src/diagnostic-store.ts`, `src/tree-sitter-validation.ts` | Compiler diagnostics, the per-source store, the syntax pass                                                                                                                               |
| `src/worker/`, `src/transpile/`, `src/tssl/`                                     | Worker plumbing; the transpile worker client; the TSSL compiler client and its dialog parser                                                                                              |
| `src/td/`                                                                        | The TD dialog source parser (ts-morph)                                                                                                                                                    |
| `src/translation.ts`, `src/translation/`                                         | The translation service facade and its loader, features and write-back modules                                                                                                            |
| `src/ie-resources/`                                                              | Configured game install, strref sites and strref hovers/hints                                                                                                                             |
| `src/dialog.ts`                                                                  | The SSL dialog parser for the dialog editor                                                                                                                                               |
| `shared/parsers/` (repo root)                                                    | Tree-sitter parser factory, manager and per-language facades, shared with `@bgforge/format`                                                                                               |

## Startup and Lifecycle

**`onInitialize`** (`src/handlers/initialize.ts`) does everything a request needs before the initialize response
goes out, so the client never races a half-initialized server:

1. Reads `.bgforge.yml` project settings and starts the translation load, not awaited.
2. Registers the tree-sitter parsers and loads them with `ParserManager.initAll()`.
3. Registers the providers and aliases, then `registry.init()` initializes each provider in turn. The workspace
   scan that fills the indexes starts after that in the background, held behind the translation load
   (`scanAfter`); requests served before it finishes read a partial index. It logs
   `LSP_LOG_WORKSPACE_SCAN_COMPLETE` when done - see [lsp-api.md](../docs/lsp-api.md).
4. Builds the `ServerContext` and returns the capabilities from `src/server-capabilities.ts`.

**`onInitialized`** registers for configuration changes, fetches the real `bgforge` settings, and registers the
file watchers built from each provider's `indexExtensions`.

**State holders.** `src/server-context.ts` holds the session state (settings, translation service, configured game)
behind a barrier promise, so a handler that arrives before `onInitialize` finishes awaits instead of failing.
`src/lsp-connection.ts` and `src/settings-service.ts` hold the connection and the per-document settings getter,
so modules can reach them without importing `src/server.ts`.

**Settings** arrive through `workspace/configuration`. The session copy is refreshed in `onInitialized` and on
`onDidChangeConfiguration` (`src/handlers/config.ts`), which pushes it into the registry's provider context too.
Per-document settings are fetched with the document's scope and cached until the next configuration change
(`makeGetDocumentSettings()` in `src/handlers/document-lifecycle.ts`).

**Documents** (`src/handlers/document-lifecycle.ts`): open, change and save reload the provider's file data and the
translation data, and run the diagnostic passes described under [Diagnostics](#diagnostics). Reloads on change
are debounced per URI; a save cancels a pending compile and runs its own. Opening a `.tssl`, `.tbaf` or `.td`
document starts the worker it will need. Watched-file events outside open documents go through
`ProviderRegistry.handleWatchedFileChange()` (`src/core/file-watcher-manager.ts`), which calls `reloadFileData()`
or `onWatchedFileDeleted()` on whichever provider claims the extension.

**Shutdown** (`src/server.ts`) disposes the debouncers, aborts in-flight compiles and stops the two ts-morph workers.

## Request Routing

`src/handlers/*.ts` receive the LSP requests. A handler resolves the document and asks `ProviderRegistry`, which
maps the language id (resolving aliases), normalizes the URI and calls the provider method if the provider has
one. Precedence between resolution sources is written at the handler, not in shared helpers, so each feature's
order is explicit in one place.

**Hover** (`src/handlers/hover.ts`):

1. No word at the cursor, or the provider's feature gate says the cursor is in a comment: nothing.
2. TLK strref under the cursor, for a language whose provider locates strrefs.
3. Translation reference (`@123`, `mstr(123)`, `tra(123)`).
4. The provider's own AST-based hover. It returns `HoverResult` (`src/core/capabilities.ts`), which separates
   "nothing to show, stop" from "not mine, keep looking".
5. Cursor inside a string: nothing. Otherwise the data hover, from `resolveSymbol()` over headers and static data.

**Definition** (`src/handlers/definition.ts`): comment gate; the provider's AST-based definition; translation
definition; then, outside strings, the symbol's indexed location.

**Inlay hints** (`src/handlers/inlay-hints.ts`) merge the provider's hints, strref hints and translation hints
rather than taking the first non-empty source, since one line can carry both kinds of reference.

**Call hierarchy** (`src/handlers/call-hierarchy.ts`) stamps the language id on each prepared item, because the
follow-up incoming/outgoing requests carry no document. The graphs are `src/fallout-ssl/call-hierarchy.ts` and
`src/weidu-tp2/call-hierarchy.ts`.

**Workspace symbols** aggregate every provider for a plain `workspace/symbol`. The
`bgforge.workspaceSymbols.<languageId>` command scopes the search to one language, and the VS Code client sends
it for the active editor's language - see [lsp-api.md](../docs/lsp-api.md).

## Provider Capabilities

A provider is `ProviderBase` plus any subset of the capability interfaces in `src/core/capabilities.ts`; each
provider's `implements` clause says which. `src/core/format-only-provider.ts` builds the format-only providers.

Shared behaviour reaches providers through factory functions configured per language (block types, comment
types, return modes) in `src/shared/`, not through inheritance. The indexing lifecycle is shared too:
`ProviderRegistry` owns the startup scan, watched-file handling and reload dispatch through `indexExtensions`, while
each provider decides which indexed symbols are visible to fallback lookup, completion or rename.

## Symbols and Indexes

`Symbols` (`src/core/symbol-index.ts`) stores `IndexedSymbol`s (`src/core/symbol.ts`) per file, with the design
principles in its header: file-level updates, immutable symbols, scope-aware queries, and responses (completion
item, hover, signature) computed when a file is indexed rather than per request. `src/core/file-index.ts` keeps
`Symbols` and the `ReferencesIndex` (`src/shared/references-index.ts`) in lockstep from each file's
`ParseResult`. A symbol's source is one of:

- **Static** - engine data, loaded by `loadStaticSymbols()` (`src/core/static-loader.ts`) from the JSON the
  [data pipeline](../docs/data-pipeline.md) generates; it has no location.
- **Workspace** - parsed from a header (`.h`, `.tph`); visible to hover, definition and completion fallback
  everywhere.
- **Navigation** - parsed from any other indexed file (an `.ssl` script, a `.tp2`); feeds workspace symbols and
  cross-file navigation but never global fallback lookup, so one script's names do not resolve in another.

Local symbols of the open document are computed from its text on request and the document's own indexed entry is
excluded from completion (`excludeUri`), so a name has one source at a time.

**Name case.** Symbol and reference keys fold per language (`src/core/name-case.ts`): Fallout SSL folds case, so
cross-file lookups match any spelling; WeiDU D labels and TP2 names compare exactly.

**References and rename.** Each language's `parseFile()` emits the file's references once, when it is indexed, so
Find References and rename query `ReferencesIndex` instead of re-reading the workspace. Only file-scoped symbols get
cross-file results; procedure-, function- and loop-scoped names stay single-file. Workspace-wide SSL rename uses
the same index rather than an include graph, which is what catches a header using a symbol it does not include
itself (`src/fallout-ssl/rename.ts`).

Per-language implementations that look alike but encode different semantics:

| Feature              | Why per-language                                                                                                                  |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Definition           | Different scoping models: SSL procedures and macros, TP2 functions and variables, D dialog-scoped labels                          |
| Document symbols     | SSL has explicit `variable` declarations; TP2 keeps the first occurrence of each variable                                         |
| Reference extraction | SSL indexes every identifier; TP2 only function and macro names; D uses `dialogFile:label` composite keys                         |
| Rename               | SSL is workspace-wide for header symbols; TP2 and D rename within the file                                                        |
| References           | SSL skips procedure-local shadows; D merges cross-file label references, returning only those when the label is defined elsewhere |
| Folding              | Language-specific block node types passed to the shared `createFoldingRangesProvider()`                                           |

**Tree-sitter error recovery.** Error recovery can fabricate valid-looking nodes from broken input. TP2 completion
defends against phantom zero-width assignments in two layers; the reasoning and the alternatives considered are
in `isPhantomAssignment()`'s JSDoc (`src/weidu-tp2/tree-utils.ts`). TP2 document symbols skip nodes with
`hasError` but still recurse into their children.

## Diagnostics

Three producers publish diagnostics for one file, and `textDocument/publishDiagnostics` replaces a file's whole
set on every send. `src/diagnostic-store.ts` therefore keeps one bucket per (URI, source) - `compiler`,
`tree-sitter`, `translation` - and republishes the union on every change.

**Syntax pass.** `src/tree-sitter-validation.ts` parses the document and publishes ERROR and MISSING nodes
(`src/shared/tree-sitter-diagnostics.ts`) for every language with a registered parser, on change and save, gated
by `bgforge.diagnostics` and independent of `bgforge.validate`. A large document coalesces the pass instead of
running it per keystroke (`src/shared/parse-scheduling.ts`). Quick fixes (`src/handlers/code-action.ts`) act only
on its MISSING-token diagnostics.

**Translation pass.** Unresolved translation references, published on open, change and save beside the syntax
pass.

**Compilers.** `bgforge.validate` decides whether a compile runs on save, on type (debounced) or only on command.
`compile()` in `src/compile.ts` routes to a provider's `compile()` or to the TypeScript-based chains; the handlers
call it fire-and-forget through `src/handlers/compile-error.ts`.

| Source       | Back end                                                                                                                                                                         | Where                                                                           |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `.ssl`       | An external compiler (`bgforge.falloutSSL.compilePath`), else `bgforge.falloutSSL.compiler`: WebAssembly `sslc` in a forked process, or the extension's own compiler on a worker | `src/fallout-ssl/compiler.ts`, `src/sslc/`, `src/fallout-ssl/compile-worker.ts` |
| `.baf`       | `bgforge.weidu.compiler`: WeiDU, or the extension's own BAF compiler (`compilers/bcs`) in-process                                                                                | `src/weidu-baf/diagnostics.ts`                                                  |
| `.d`, `.tp2` | WeiDU `--parse-check`                                                                                                                                                            | `src/weidu-compile.ts`                                                          |
| `.tssl`      | Compiled straight to INT on the TSSL worker; `.ssl` output only with `bgforge.tssl.emitSsl`                                                                                      | `src/tssl/compile-int.ts`                                                       |
| `.tbaf`      | Transpiled on the transpile worker, then the `.baf` back end above                                                                                                               | `src/compile.ts`                                                                |
| `.td`        | Transpiled on the transpile worker, then WeiDU when a WeiDU path and game path are set                                                                                           | `src/compile.ts`                                                                |

The rules around the back ends live in the module headers: the tmp file beside the source and its watcher
exclusion (`src/fallout-ssl/compiler.ts`), per-URI abort and tmp cleanup (`src/core/compile-with-tmp-file.ts`),
queueing compiles that share a directory (`src/core/directory-gate.ts`), fallback diagnostics for unparseable
output (`src/diagnostics.ts`), and WeiDU output parsing (`src/weidu-compile.ts`). A diagnostic reported against a
transpiler's generated file is moved back onto the source line that produced it
(`src/core/generated-diagnostics.ts`).

## Worker Threads

`src/worker/worker-client.ts` is the server side of every worker: start and keep the thread, match replies to
requests, bound each request, fail in-flight work when the thread dies.

- **ts-morph worker** (`src/worker/ts-morph-worker.ts`) - one bundle, two instances, so a dialog parse never
  queues behind a TSSL compile. The TSSL compiler instance (`src/tssl/compile-worker-client.ts`) holds the
  ts-morph project between compiles. The transpile instance (`src/transpile/transpile-worker-client.ts`) runs the
  TD and TBAF transpilers and the TD and TSSL dialog parses. The compiler instance starts on the first open of a
  `.tssl`, the transpile instance on the first open of a `.tbaf` or `.td` (`prewarmWorkerFor()` in
  `src/handlers/document-lifecycle.ts`) or else on its first request, such as a TSSL dialog parse; both stop at
  shutdown.
- **SSL compile worker** (`src/fallout-ssl/compile-worker.ts`) - the extension's own SSL compiler, built as its own
  bundle beside `server.js` (a worker thread starts from its own file - `scripts/build-base-server.sh`); started on
  the first compile that selects it.

## Translation

`src/translation.ts` is the facade over `src/translation/`: it owns the shared state and the request guards, and
delegates to the loader, the features (hover, definition, references, inlay hints, diagnostics) and write-back.
No provider implements translation features; the handlers call the service directly.

- `.ssl` and `.tssl` reference `.msg` entries through calls such as `mstr(123)` and `NOption(123)`;
  `.baf`, `.d` and `.tp2` reference `.tra` entries as `@123`; `.tbaf` and `.td` use `tra(123)`. The patterns are in
  `src/core/patterns.ts`.
- A consumer's translation file is named by a `/** @tra file */` comment on its first line, or matched by basename
  when `auto_tra` is on. The directory is `mls.translation.directory` in `.bgforge.yml`.
- The translation files are loaded at startup and re-indexed on change; a reverse index from each translation file
  to its consumers answers Find References from a `.tra`/`.msg` entry.

## IE Resources and Strrefs

`src/ie-resources/configured-game.ts` opens the Infinity Engine install named by `bgforge.weidu.gamePath` through
`@bgforge/binary/archive`, and resolves TLK strrefs and IDS tables against it. A provider that implements
`StrRefCapability` reports where the strrefs sit (`src/ie-resources/strref-sites.ts`, used by BAF), and
`src/ie-resources/strref-features.ts` turns those sites into hovers and inlay hints for any such language. Strref
hover is the first source in the hover chain. The built-in BAF compiler reads the same opened game for its tables.

## Dialog Editor, Server Side

The dialog editor asks the server for two commands (`src/handlers/execute-command.ts`); the client does all
editing - see [docs/architecture.md](../docs/architecture.md#client-and-server).

- **`bgforge.parseDialog`** picks a parser by language and extension and returns the dialog tree with the
  document's translation strings: `src/dialog.ts` (SSL), `src/weidu-d/dialog.ts` with `dialog-utils.ts` and
  `dialog-modify.ts` beside it (D, including the blocks that patch existing dialogs), and the ts-morph source
  parsers `src/td/dialog-source.ts` and `src/tssl/dialog-source.ts`, which run on the transpile worker.
- **`bgforge.saveDialogTra`** writes edited strings to the resolved `.tra`/`.msg` (`src/translation/write-back.ts`).

The dialog model and its per-language edit and serialize modules are in the repo-root `shared/`, used by the
client.

## Tree-Sitter Integration

### Parser Initialization

`ParserManager` (`shared/parsers/parser-manager.ts`) owns parser lifecycle for the server and `@bgforge/format`.
`initAll()` loads the grammars one at a time, because concurrent `Language.load()` calls race on web-tree-sitter's
shared `TRANSFER_BUFFER`; that runs in `onInitialize` before any provider initializes. The provider loop in
`registry.init()` is sequential too, for its own reason, commented there. Each language's facade
(`shared/parsers/<lang>.ts`) re-exports the manager's calls for that language, and tests use `initOne()` to load a
single parser. The server installs an LSP-routed logger with `setParserLogger()`.

### Node types and caching

Node types are compared through the generated `SyntaxType` enums, never string literals; generation is described
in [grammars/README.md](../grammars/README.md) (Type Generation). Parsed trees are cached by document text in
`shared/parsers/parser-factory.ts`.

## Feature Matrix

| Provider     | Completion | Hover | Signature | Definition | References | Call Hierarchy | Format | Symbols | Workspace Symbols | Rename |    Inlay     | Folding | Selection Range | Diagnostics | Quick Fixes | JSDoc | Semantic Tokens |
| ------------ | :--------: | :---: | :-------: | :--------: | :--------: | :------------: | :----: | :-----: | :---------------: | :----: | :----------: | :-----: | :-------------: | :---------: | :---------: | :---: | :-------------: |
| fallout-ssl  |     Y      |   Y   |     Y     |     Y      |     Y      |       Y        |   Y    |    Y    |         Y         |   Y    |     .msg     |    Y    |        Y        |      Y      |      Y      |   Y   |        Y        |
| weidu-baf    |     Y      |   Y   |           |    n/a     |    n/a     |      n/a       |   Y    |         |        n/a        |  n/a   | .tra, strref |    Y    |        Y        |      Y      |      Y      |  n/a  |                 |
| weidu-d      |     Y      |   Y   |           |     Y      |     Y      |                |   Y    |    Y    |         Y         |   Y    |     .tra     |    Y    |        Y        |      Y      |      Y      |   Y   |                 |
| weidu-tp2    |     Y      |   Y   |           |     Y      |     Y      |       Y        |   Y    |    Y    |         Y         |   Y    |     .tra     |    Y    |        Y        |      Y      |      Y      |   Y   |        Y        |
| weidu-log    |    n/a     |  n/a  |    n/a    |     Y      |    n/a     |      n/a       |  n/a   |   n/a   |        n/a        |  n/a   |     n/a      |   n/a   |       n/a       |     n/a     |     n/a     |  n/a  |       n/a       |
| worldmap     |     Y      |   Y   |    n/a    |    n/a     |    n/a     |      n/a       |  n/a   |   n/a   |        n/a        |  n/a   |     n/a      |   n/a   |       n/a       |     n/a     |     n/a     |  n/a  |       n/a       |
| weidu-tra    |            |   Y   |           |     Y      |     Y      |                |   Y    |    Y    |                   |        |              |    Y    |                 |      Y      |             |       |                 |
| fallout-msg  |            |   Y   |           |     Y      |     Y      |                |   Y    |    Y    |                   |        |              |    Y    |                 |      Y      |             |       |                 |
| infinity-2da |            |       |           |            |            |                |   Y    |         |                   |        |              |         |                 |             |             |       |        Y        |
| scripts-lst  |            |       |           |            |            |                |   Y    |         |                   |        |              |         |                 |             |             |       |                 |

`Y` is implemented, `n/a` does not apply, blank is not implemented. Hover, definition and references on
`weidu-tra`/`fallout-msg` come from the translation service; their diagnostics from the syntax pass. `strref` in
the Inlay column means TLK string references, which also get a hover.

### Deliberate N/A

These features are absent because they do not apply to the language, not because they are unimplemented:

- **BAF Symbols / Definition / Rename / Call Hierarchy** - BAF files are flat sequences of IF/THEN/RESPONSE blocks
  with no named procedures, functions, or reusable constructs to navigate to or rename.
- **BAF JSDoc** - no user-defined constructs to document.
- **Worldmap** - a simple key-value config file, no programming constructs.
- **TP2 Signature Help** - TP2 calls take named keyword parameters (`INT_VAR`/`STR_VAR`/`RET` blocks), not positional
  arguments, and signature help is built to track positional ones. Parameter documentation is surfaced via hover and
  completion instead.
- **TP2 Parameter Inlay Hints** - parameters are already named explicitly in the source (`INT_VAR foo = 0`) and
  documented via hover and completion. There is nothing implicit to annotate.

### Two Feature Matrices (README + `server/INTERNALS.md`)

The feature matrix appears in two forms serving different audiences; both are maintained.

- **README** - user-facing languages ("Fallout SSL", "WeiDU TP2"), check marks, includes a "Dialog editor" row.
  Optimized for someone deciding whether the extension supports their workflow.
- **This table** - provider names (`fallout-ssl`, `weidu-tp2`), the `Y`/`n/a`/blank distinction, and the extra
  providers and columns that matter only to implementers.

Collapsing to either form would hide information the other audience needs. Both are updated when a user-visible
feature ships; `scripts/utils/test/feature-matrix-sync.test.ts` fails when the two disagree on the feature/language
surface they share.

## Latency Budgets

The server wraps most of its LSP handlers with `timeHandler` (`src/shared/time-handler.ts`) - not all of them:
signature help and inlay hints, among others, are unwrapped, so `rg timeHandler server/src/handlers` is the list.
When a handler exceeds the threshold it logs a `[lsp-timing]` warning to the LSP console. The threshold is
`DEFAULT_THRESHOLD_MS = 50` ms and can be overridden at startup via the `BGFORGE_LSP_SLOW_MS` environment variable.

The threshold is a per-request budget, not an aggregate: a single request that takes longer than 50 ms triggers a
warning regardless of prior request history. Startup is not wrapped: `onInitialize` is one-off work (loading the
grammars, providers and static data), not a per-request cost.

Revisit the threshold when a provider is added or a data source grows significantly, re-measuring the wrapped
handlers with the new language loaded.

## Testing

Commands: [scripts/README.md](../scripts/README.md).

### Test layers

| Layer       | Config                          | What it covers                                                                                                                |
| ----------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Unit        | `vitest.config.mts`             | Server logic against inline sources; carries the coverage floors                                                              |
| Integration | `vitest.integration.config.mts` | LSP features over real mod code in `external/` (`test/integration/`), with the connection mock in `test/integration/setup.ts` |
| Smoke       | `vitest.smoke.config.mts`       | The built bundles: the server over stdio, `lsp-probe`, and the ts-morph worker in both roles                                  |
| Benchmarks  | `test/perf/`                    | `pnpm bench`; not a gate                                                                                                      |
| Mutation    | `vitest.mutation.config.mts`    | The unit suite without `external/` fixtures, for pointing Stryker at the server                                               |

### Coverage scope

Unit coverage measures every source file the unit tests import. Every per-language `provider.ts` dispatcher is
excluded (`vitest.config.mts`): each is thin glue whose methods delegate to unit-tested sub-modules, with
end-to-end behaviour verified by `test/integration/` against real mod files. They are excluded uniformly so a
dispatcher is not covered by redundant unit tests, and any new provider dispatcher belongs in that list too. The
floors themselves are in the config; how floors are set and moved is in
[docs/development.md](../docs/development.md#coverage-thresholds).

## Adding a New Provider

1. Add the language id to `shared/languages.ts` and the language to `package.json` `contributes.languages`.
2. Create the grammar in `grammars/<lang>/`, with the `@asgerf/dts-tree-sitter` devDependency and a
   `generate:types` script modelled on an existing grammar's `package.json`; generate the types as
   [grammars/README.md](../grammars/README.md) describes, and add the `src/<lang>/syntax-type.ts` re-export.
3. Add the parser facade `shared/parsers/<lang>.ts` and register the parser in `src/handlers/initialize.ts`
   (`parserManager.register()`).
4. Create `src/<lang>/provider.ts` implementing `ProviderBase` and the capability interfaces it supports, and
   register it in `src/handlers/initialize.ts`. A language that indexes user-defined names also declares its name
   case in `src/core/name-case.ts`.
5. Advertise any capability the server does not yet offer in `src/server-capabilities.ts`.
6. Add the dispatcher to the coverage exclusions in `vitest.config.mts`.
7. Add a row to the [Feature Matrix](#feature-matrix), and to the README matrix if the language is user-facing.
8. Add engine data under `data/` if needed - see [docs/data-pipeline.md](../docs/data-pipeline.md).
