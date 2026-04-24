# Server Internals

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) | [docs/architecture.md](../docs/architecture.md) | [scripts/README.md](../scripts/README.md)

LSP server providing IDE features for niche scripting languages used in classic RPG modding.

## Overview

```
+------------------+    IPC/stdio   +------------------+
|   Editor Client  | <------------> |   LSP Server     |
|                  |                |   (server.ts)    |
+------------------+                +------------------+
                                            |
                                            v
                                   +------------------+
                                   | ProviderRegistry |
                                   +------------------+
                                            |
              +-----------------------------+-----------------------------+
              |              |              |              |              |
              v              v              v              v              v
        +---------+    +---------+    +---------+    +---------+    +---------+
        | Fallout |    | WeiDU   |    | WeiDU   |    | WeiDU   |    | Fallout |
        |   SSL   |    |   BAF   |    |    D    |    |   TP2   |    |Worldmap |
        +---------+    +---------+    +---------+    +---------+    +---------+
```

## Core Concepts

### Single Source of Truth: Symbols

Symbols from headers and static data are stored in a unified index:

- **Static Symbols** (global) - Built-in functions from YAML/JSON (e.g., COPY_EXISTING)
- **Workspace Symbols** - From .h/.tph header files, indexed via `reloadFileData()`
- **Local Symbols** - Current file's variables, computed on-demand via `localCompletion()` and `extractLocalSymbols()`. Both skip phantom assignment nodes created by tree-sitter error recovery (see `isPhantomAssignment()` in `tree-utils.ts`).

**No duplication by design**: When querying completions, `getCompletions(uri)` passes `excludeUri` to skip the current file's indexed symbols. Local symbols are always computed fresh from the editor buffer. This ensures each symbol has exactly one source.

**Null for missing data**: Static symbols have `location: null` and `source.uri: null` (not empty strings). This is enforced at input time by `static-loader.ts`, and TypeScript ensures null checks at all usage sites. Use `lookupDefinition()` for go-to-definition - it returns `null` for static symbols.

### Pre-Computed Responses

LSP responses are computed once at parse time, not on each request:

```
Header File Change
       |
       v
  +---------+       +------------------+
  | Parser  | ----> | IndexedSymbol    |
  +---------+       |------------------|
                    | .name            |
                    | .location        |
                    | .completion  <------- Ready for getCompletions()
                    | .hover       <------- Ready for getHover()
                    | .signature   <------- Ready for getSignature()
                    +------------------+
```

## Directory Structure

```
server/src/
|
+-- server.ts                 # LSP entry point
+-- provider-registry.ts      # Routes requests to providers
+-- language-provider.ts      # Provider interface
|
+-- core/
|   +-- symbol.ts             # IndexedSymbol type definitions
|   +-- symbol-index.ts       # Symbols class - unified storage & query
|   +-- static-loader.ts      # Loads built-in symbols from JSON
|   +-- normalized-uri.ts     # Branded NormalizedUri type, URI encoding canonicalization
|   +-- parser-manager.ts     # Centralized tree-sitter parser lifecycle (registration, sequential init, caching)
|   +-- capabilities.ts       # Provider capability interfaces (FormattingCapability, SymbolCapability, etc.)
|   +-- languages.ts          # Language IDs & file extensions
|   +-- patterns.ts           # Regex patterns
|   +-- location-utils.ts     # Position/range helpers
|
+-- fallout-ssl/              # Fallout 1/2 scripting
|   +-- tree-sitter.d.ts      # Generated SyntaxType enum
|   +-- provider.ts
|   +-- parser.ts             # Thin re-export from ParserManager
|   +-- format.ts
|   +-- header-parser.ts      # .h file parsing
|   +-- symbol.ts             # DocumentSymbol extraction (procedures with param/var children)
|   +-- completion.ts
|   +-- hover.ts
|   +-- definition.ts
|   +-- references.ts         # Find References (single-file + cross-file via ReferencesIndex)
|   +-- call-sites.ts         # Call-site extractor for cross-file references index
|   +-- rename.ts             # Single-file + workspace-wide rename orchestration
|   +-- symbol-scope.ts       # Scope determination (file vs procedure) for rename
|   +-- reference-finder.ts   # Scope-restricted reference finding for rename
|   +-- signature.ts
|
+-- weidu-baf/                # WeiDU BAF scripts
|   +-- tree-sitter.d.ts      # Generated SyntaxType enum
+-- weidu-d/                  # WeiDU dialog files
|   +-- tree-sitter.d.ts      # Generated SyntaxType enum
|   +-- state-utils.ts        # Dialog-scoped state label utilities (shared by definition, rename, hover)
|   +-- references.ts         # Find References (single-file + cross-file via ReferencesIndex)
|   +-- call-sites.ts         # Call-site extractor for cross-file references index
|   +-- rename.ts             # Dialog-scoped state label rename
|   +-- hover.ts              # JSDoc hover for state labels
+-- weidu-tp2/                # WeiDU mod installers
|   +-- tree-sitter.d.ts      # Generated SyntaxType enum
|   +-- references.ts         # Find References (single-file + cross-file via ReferencesIndex)
|   +-- call-sites.ts         # Call-site extractor for cross-file references index
+-- fallout-worldmap/         # Fallout worldmap.txt
|
+-- tssl/                     # TSSL dialog bridge (depends on tree-sitter + LSP)
+-- td/                       # TD dialog bridge (depends on tree-sitter + LSP)
|
+-- shared/
|   +-- hash.ts               # Shared djb2 hash for cache keys
|   +-- parser-factory.ts     # Cached tree-sitter parser factory (used by ParserManager)
|   +-- references-index.ts   # ReferencesIndex for cross-file Find References
|   +-- completion.ts         # Shared completion utilities
|   +-- hover.ts              # Shared hover utilities
|   +-- signature.ts          # Signature help utilities
|   +-- jsdoc.ts              # JSDoc parsing
|
+-- translation.ts            # .tra/.msg translation service
+-- compile.ts                # Compilation dispatch
+-- user-messages.ts          # User-facing message wrappers (auto-decode file:// URIs)
+-- settings.ts               # User settings
+-- common.ts                 # Logging, file utils
```

## Data Flow

### Initialization

```
Extension Activated
       |
       v
+----------------+
| server.ts      |
| onInitialized  |
+----------------+
       |
       v
+------------------+     Sequential init     +------------------+
| ParserManager    | ------------------->    | tree-sitter-     |
| initAll()        |   (WASM constraint)     | {lang}.wasm      |
+------------------+                         +------------------+
       |
       v
+------------------+                         +------------------+
| ProviderRegistry |  ------------------>    | Each Provider    |
| init()           |                         | init()           |
+------------------+                         +------------------+
       |                                            |
       v                                            v
+------------------+                         +------------------+
| Scan workspace   |                         | Load static      |
| for headers      |                         | symbols (JSON)   |
+------------------+                         +------------------+
       |                                            |
       v                                            v
+------------------+                         +------------------+
| Parse .h/.tph    |                         | Symbols          |
| files            |                         | loadStatic()     |
+------------------+                         +------------------+
       |
       v
+------------------+
| Symbols          |
| updateFile()     |
+------------------+
```

### Hover Request

```
                             onHover(position)
                                    |
                                    v
                          +------------------+
                          | Extract symbol   |
                          | at position      |
                          +------------------+
                                    |
                                    v
    +---------------------------------------------------------------+
    |                      Try in order:                             |
    +---------------------------------------------------------------+
    |                                                                |
    |   1. Translation Hover                                         |
    |   +------------------+                                         |
    |   | translation      |  For @123, NOption(123), tra(N) refs   |
    |   | .getHover()      |                                         |
    |   +------------------+                                         |
    |           |                                                    |
    |           | null = not a translation reference                  |
    |           v                                                    |
    |   2. Local Hover (AST-based)                                   |
    |   +------------------+                                         |
    |   | provider.hover() |  Returns HoverResult discriminated      |
    |   +------------------+  union (handled/notHandled)             |
    |           |                                                    |
    |           | handled=false = not found locally                   |
    |           v                                                    |
    |   3. Data Hover (unified symbol resolution)                    |
    |   +------------------+                                         |
    |   | resolveSymbol()  |  Local-first, then headers/static       |
    |   | .hover           |  SSL: engine proc doc appended to       |
    |   +------------------+  local procedure hover at build time    |
    |                                                                |
    +---------------------------------------------------------------+
                                    |
                                    v
                          +------------------+
                          | Return first     |
                          | non-null result  |
                          +------------------+
```

### Definition Request

```
                          onDefinition(position)
                                    |
                                    v
    +---------------------------------------------------------------+
    |                      Try in order:                             |
    +---------------------------------------------------------------+
    |                                                                |
    |   1. Provider Definition (AST-based)                           |
    |   +------------------+                                         |
    |   | provider         |  SSL: procedures/macros/vars/exports/  |
    |   | .definition()    |       #includes                        |
    |   |                  |  TP2: variables/functions/INCLUDEs     |
    |   +------------------+  D: dialog-scoped state labels          |
    |           |                                                    |
    |           | null = not found locally                            |
    |           v                                                    |
    |   2. Translation Definition                                    |
    |   +------------------+                                         |
    |   | translation      |  @123 -> line in .tra/.msg file        |
    |   | .getDefinition() |                                         |
    |   +------------------+                                         |
    |           |                                                    |
    |           | null = not a translation ref                        |
    |           v                                                    |
    |   3. Data Definition (from headers)                            |
    |   +------------------+                                         |
    |   | provider         |  Symbol location from indexed headers   |
    |   | .getSymbolDefn() |  Returns null for static (no location)  |
    |   +------------------+                                         |
    |                                                                |
    +---------------------------------------------------------------+
```

### File Change

```
Document Changed (debounced 300ms)
              |
              v
    +------------------+
    | Is watched file? |
    | (.h, .tph, etc.) |
    +------------------+
         /          \
       Yes           No
        |             |
        v             v
+----------------+  +----------------+
| provider       |  | Local symbols  |
| .reloadFile()  |  | only (no index |
+----------------+  | update)        |
        |           +----------------+
        v
+------------------+
| Symbols          |   Symbol store (headers)
| .updateFile()    |
+------------------+
| WsSymbolIndex    |   Workspace symbols (Ctrl+T)
| .updateFile()    |
+------------------+
| ReferencesIndex  |   Cross-file references
| .updateFile()    |
+------------------+
```

## Symbol Type System

### Discriminated Union

`IndexedSymbol` is a union type where `.kind` determines available fields:

| Type              | Extra Field | Description                   |
| ----------------- | ----------- | ----------------------------- |
| `CallableSymbol`  | `.callable` | Functions, procedures, macros |
| `VariableSymbol`  | `.variable` | Variables, parameters         |
| `ConstantSymbol`  | `.constant` | Constant values               |
| `StateSymbol`     | -           | Dialog states (D files)       |
| `ComponentSymbol` | -           | TP2 mod components            |

### Symbol Kinds

| Category   | Kind           | Example                    |
| ---------- | -------------- | -------------------------- |
| Callables  | `Function`     | DEFINE_ACTION_FUNCTION     |
|            | `Procedure`    | SSL procedure              |
|            | `Macro`        | #define, DEFINE\_\*\_MACRO |
|            | `Action`       | WeiDU action (BAF/D/TP2)   |
|            | `Trigger`      | WeiDU trigger (BAF/D)      |
| Data       | `Variable`     | OUTER_SET, SET             |
|            | `Constant`     | #define constant           |
|            | `Parameter`    | INT_VAR, STR_VAR           |
|            | `LoopVariable` | PHP_EACH iteration var     |
| Structures | `State`        | Dialog state (D files)     |
|            | `Component`    | TP2 mod component          |

### Scope Hierarchy

| Scope     | Visibility                                  |
| --------- | ------------------------------------------- |
| Global    | Built-in functions, always visible          |
| Workspace | From headers (.h, .tph), visible everywhere |
| File      | Current file only (script-scope variables)  |
| Function  | Inside procedure/function body only         |
| Loop      | Loop iteration variable (e.g., PHP_EACH)    |

Lookup precedence (highest to lowest): Loop > Function > File > Workspace > Global

## Provider Interface

```typescript
interface LanguageProvider {
    id: string;

    // Lifecycle
    init(context: ProviderContext): Promise<void>;

    // Gate: suppress features in comments
    shouldProvideFeatures?(text, position): boolean;

    // AST-based features (parse current document)
    format?(text, uri): FormatResult;
    symbols?(text): DocumentSymbol[];
    foldingRanges?(text): FoldingRange[];
    definition?(text, position, uri): Location | null;
    hover?(text, symbol, uri, position): HoverResult; // discriminated union
    filterCompletions?(items, text, position, uri, trigger?): CompletionItem[];
    localSignature?(text, symbol, paramIndex): SignatureHelp | null;
    rename?(text, position, newName, uri): WorkspaceEdit | null;
    prepareRename?(text, position): { range; placeholder } | null;
    inlayHints?(text, uri, range): InlayHint[];
    workspaceSymbols?(query): SymbolInformation[];

    // Data features (unified symbol resolution)
    resolveSymbol?(name, text, uri): IndexedSymbol | undefined; // single lookup entry point
    getCompletions?(uri): CompletionItem[];
    getSignature?(uri, symbol, paramIndex): SignatureHelp | null;
    getSymbolDefinition?(symbol): Location | null;

    // File watching
    indexExtensions?: string[];
    reloadFileData?(uri, text): void;
    onWatchedFileDeleted?(uri): void;
    onDocumentClosed?(uri): void;

    // Compilation
    compile?(uri, text, interactive): Promise<void>;
}
```

**HoverResult**: Discriminated union replacing the ambiguous `Hover | null | undefined`:

- `{ handled: true, hover: Hover }` — provider found a result (show it)
- `{ handled: true, hover: null }` — provider handled it, nothing to show (block fallthrough)
- `{ handled: false }` — provider didn't handle it, fall through to data-driven hover

Factory helpers: `HoverResult.found(hover)`, `HoverResult.empty()`, `HoverResult.notHandled()`

## Tree-Sitter Integration

### Parser Initialization

```
+------------------+     +------------------+     +------------------+
| ParserManager    | --> | createCached     | --> | tree-sitter-     |
| initAll()        |     | ParserModule()   |     | {lang}.wasm      |
+------------------+     +------------------+     +------------------+
                                |
                                v
                         +------------------+
                         | Parser instance  |
                         | (per language)   |
                         +------------------+
```

**ParserManager** (`core/parser-manager.ts`) centralizes parser lifecycle. Parsers are
registered and initialized sequentially (WASM `TRANSFER_BUFFER` constraint) before
providers start. Each language's `parser.ts` is a thin re-export that delegates to the
manager. Tests can use `initOne()` to initialize a single parser without the full server
startup.

### SyntaxType Enum

Each grammar generates a `tree-sitter.d.ts` file with a `SyntaxType` enum for type-safe node type comparisons:

```typescript
// Generated from grammar - use instead of hardcoded strings
import { SyntaxType } from "./tree-sitter.d";

if (node.type === SyntaxType.State) { ... }  // Good
if (node.type === "state") { ... }           // Bad - no type checking
```

Generate types for a grammar:

```bash
cd grammars/{lang} && pnpm generate:types
```

This copies the generated `tree-sitter.d.ts` to `server/src/{lang}/`.

### Parse Caching

`parseWithCache(text)` hashes the input and checks a 10-entry LRU cache before parsing. This avoids re-parsing on repeated requests (e.g., multiple hovers on same file).

## Feature Matrix

| Provider     | Completion | Hover | Signature | Definition | References | Format | Symbols | Workspace Symbols | Rename | Inlay | Folding | Diagnostics | JSDoc | Semantic Tokens |
| ------------ | :--------: | :---: | :-------: | :--------: | :--------: | :----: | :-----: | :---------------: | :----: | :---: | :-----: | :---------: | :---: | :-------------: |
| fallout-ssl  |     Y      |   Y   |     Y     |     Y      |     Y      |   Y    |    Y    |         Y         |   Y    | .msg  |    Y    |      Y      |   Y   |        Y        |
| weidu-baf    |     Y      |   Y   |           |    n/a     |    n/a     |   Y    |         |        n/a        |  n/a   | .tra  |    Y    |      Y      |  n/a  |                 |
| weidu-d      |     Y      |   Y   |           |     Y      |     Y      |   Y    |    Y    |         Y         |   Y    | .tra  |    Y    |      Y      |   Y   |                 |
| weidu-tp2    |     Y      |   Y   |           |     Y      |     Y      |   Y    |    Y    |         Y         |   Y    | .tra  |    Y    |      Y      |   Y   |        Y        |
| weidu-log    |    n/a     |  n/a  |    n/a    |     Y      |    n/a     |  n/a   |   n/a   |        n/a        |  n/a   |  n/a  |   n/a   |     n/a     |  n/a  |       n/a       |
| worldmap     |     Y      |   Y   |    n/a    |    n/a     |    n/a     |  n/a   |   n/a   |        n/a        |  n/a   |  n/a  |   n/a   |     n/a     |  n/a  |       n/a       |
| weidu-tra    |            |   Y   |           |     Y      |     Y      |   Y    |         |                   |        |       |         |             |       |                 |
| fallout-msg  |            |   Y   |           |     Y      |     Y      |   Y    |         |                   |        |       |         |             |       |                 |
| infinity-2da |            |       |           |            |            |   Y    |         |                   |        |       |         |             |       |        Y        |
| scripts-lst  |            |       |           |            |            |   Y    |         |                   |        |       |         |             |       |                 |

## Request Routing

1. `server.ts` receives LSP request (e.g., `connection.onHover`)
2. `ProviderRegistry` looks up provider by `langId` (or alias)
3. Provider method called (local AST-based or data-based)
4. Result returned to client

### Language Aliases

| Alias     | Routes to |
| --------- | --------- |
| weidu-slb | weidu-baf |
| weidu-ssl | weidu-baf |

## Shared Utilities (`shared/`)

Reusable infrastructure that providers consume via configuration, not inheritance:

| Module                  | Pattern                                                                                 | Used By             |
| ----------------------- | --------------------------------------------------------------------------------------- | ------------------- |
| `parser-factory.ts`     | Factory: `createCachedParserModule(wasm, name)`                                         | All 4 LSP providers |
| `folding-ranges.ts`     | Factory: `createFoldingRangesProvider(init, parse, blockTypes)`                         | All 4 LSP providers |
| `comment-check.ts`      | Factory: `createIsInsideComment(init, parse, commentTypes)`                             | BAF, D, TP2         |
| `provider-helpers.ts`   | Helpers: `resolveSymbolWithLocal()`, `formatWithValidation()`, `getStaticCompletions()` | All providers       |
| `references-index.ts`   | Index: `ReferencesIndex` for cross-file Find References                                 | SSL, TP2, D         |
| `jsdoc.ts`              | Parser: `parse(text, { returnMode })` — unnamed (SSL) or named (TP2) returns            | SSL, TP2, D         |
| `jsdoc-completions.ts`  | Completions: JSDoc tag and type completions                                             | All 4               |
| `signature.ts`          | Data: `SigInfoEx`, `loadStatic()`, `getRequest()`, `getResponse()`                      | SSL (TP2 ready)     |
| `completion-context.ts` | Framework: `CompletionCategory`, `CompletionItemWithCategory`, context-based filtering  | TP2                 |
| `format-utils.ts`       | Validation: `validateFormatting()`, `createFullDocumentEdit()`, comment strippers       | All 4               |
| `format-options.ts`     | Config: `getFormatOptions()` from `.editorconfig`                                       | All 4               |
| `tooltip-format.ts`     | Formatting: `buildSignatureBlock()`, `buildWeiduHoverContent()`, `formatDeprecation()`  | All providers       |
| `tooltip-table.ts`      | Tables: `buildWeiduTable()` (4-col), `buildFalloutArgsTable()` (2-col)                  | SSL, BAF, D, TP2    |
| `semantic-tokens.ts`    | Encoding: `SemanticTokenSpan`, `encodeSemanticTokens()`, legend                         | SSL, TP2            |
| `hash.ts`               | Utility: `djb2HashHex()` for parse cache keys                                           | All parsers         |

### Design pattern

Features are shared via **factory functions with language-specific configuration**, not class inheritance. Each provider passes its own block types, comment types, or return modes to shared factories. This keeps providers decoupled while eliminating boilerplate.

Example: folding ranges require only a `Set<SyntaxType>` of foldable node types per language — the walking algorithm is shared.

The indexing lifecycle is also shared, but symbol visibility rules remain provider-specific. `ProviderRegistry` owns startup scan, watched-file create/change/delete handling, and reload dispatch via each provider's `indexExtensions`; providers still decide which indexed symbols are visible to fallback lookup, completion, or rename.

## Compilation

Compilation dispatch (`compile.ts`) routes to providers or transpiler chains:

```
onDidSave / onDidChangeContent / manual command
       |
       v
  compile(uri, langId, text)
       |
       +-- Provider has compile()? --> provider.compile(uri, text, interactive)
       |       SSL: sslc WASM (built-in) or compile.exe (external, with Wine path fix)
       |       BAF/D/TP2: weidu --parse-check (requires game path for BAF/D)
       |
       +-- Transpiler file?
               .td   --> TD transpiler --> .d file --> weidu compile
               .tbaf --> TBAF transpiler --> .baf file --> weidu compile
               .tssl --> TSSL transpiler --> .ssl file --> sslc compile
```

**Temporary files**: External compilers need files on disk. SSL writes `.tmp.ssl` (exported as `TMP_SSL_NAME` in `fallout-ssl/compiler.ts`) in the same directory as the source file so that relative `#include` paths resolve correctly. WeiDU writes to a system temp directory (`os.tmpdir()/bgforge-mls`) with unique filenames per URI (MD5 hash prefix) to prevent concurrent compilations of same-extension files from overwriting each other. The `.tmp.ssl` name is excluded from VS Code file watchers via `configurationDefaults` in `package.json` — these two locations must be kept in sync. Both SSL and WeiDU write tmp files inside `try/finally` so that cleanup runs even if `writeFile` fails (e.g., `ENOSPC`).

**Compile debouncing**: `onDidChangeContent` debounces compilation via `pendingCompiles` (300ms) to prevent rapid-fire compiler spawning when `validateOnChange` is enabled. `onDidSave` and manual compile are not debounced. Both `pendingCompiles` and `pendingReloads` timers are cleared in `onShutdown`. Both SSL and WeiDU compilation are async (return `Promise<void>`), which is essential for debouncing to work — if `compile()` returned synchronously, the debounce timer couldn't prevent overlapping processes.

**Process cancellation**: Both SSL and WeiDU compilers track in-flight compilations per URI via `AbortController`. When a new compilation starts for the same URI, the previous one is aborted — `runProcess()` passes the abort signal to `cp.execFile`, and results from aborted compiles are silently discarded. The built-in WASM compiler (`ssl_compile`) also supports cancellation by killing the forked child process when the signal fires.

**Cleanup**: Both SSL and WeiDU compilation use `try/finally` to ensure tmp files are always deleted, even if the compiler throws. Cleanup errors (e.g., `EPERM`) are logged and swallowed — they must not mask compiler results or cause unhandled rejections. External compiler processes are promisified so callers (e.g., transpile chains TD→D→WeiDU, TBAF→BAF→WeiDU, TSSL→SSL→sslc) correctly await completion. File I/O uses `fs.promises` (async) to avoid blocking the LSP thread. Fire-and-forget compile calls in `server.ts` use `.catch()` to log and swallow rejections.

**Shared compilation infrastructure** (`common.ts`): Both SSL and WeiDU compilers share `runProcess()` (Promise-wrapped `execFile` with logging and optional `AbortSignal`), `addFallbackDiagnostic()` (returns a new `ParseResult` with a line-1 diagnostic appended — does not mutate the input), `reportCompileResult()` (shows interactive success/failure messages based on `ParseResult` — intentionally treats warnings as failures since sslc warnings indicate real issues), `removeTmpFile()` (cleanup with ENOENT tolerance), and `sendParseResult()` (aggregates diagnostics by URI). Output parsing is language-specific: `parseCompileOutput()` in `compiler.ts` (uses extracted `resolveMatchFilePath()` and `execAll()` helpers) and `parseWeiduOutput()` in `weidu-compile.ts`.

**Diagnostics**: Compiler output parsed via regex into `ParseResult { errors, warnings }`. `sendParseResult()` aggregates by URI and sends LSP diagnostics. Both compilers always send diagnostics (even on success) to clear stale errors from previous runs. Multi-file error reporting supported (SSL includes can fail in header files). WeiDU deduplicates errors by location since WeiDU emits both `PARSE ERROR` and `ERROR` for the same location. WeiDU error messages include up to 4 detail lines from WeiDU output verbatim. When a compiler fails but output isn't parseable (e.g., binary not found, unexpected output format), both compilers use `addFallbackDiagnostic()` instead of silently clearing diagnostics. WeiDU shows an actionable `showError` when the binary is not found (ENOENT). All transpiler branches (TD, TBAF, TSSL) clear diagnostics before compilation.

**SSL dual-mode**: Built-in sslc-emscripten (WASM, forked process) or external compile.exe. Falls back to built-in if external unavailable. When user declines the fallback prompt, compilation returns early without attempting the failed external compiler.

## Translation Service

Centralized service (`translation.ts`) for `.tra`/`.msg` translation files. Provides hover, inlay hints, go-to-definition, and find-references for translation references. No provider implements these — it's a single shared implementation.

**Supported patterns** (by file type):

- `.ssl`, `.tssl`: `mstr(123)`, `NOption(123)`, `Reply(456)`, etc. → `.msg` files
- `.baf`, `.d`, `.tp2`: `@123` → `.tra` files
- `.tbaf`, `.td`: `tra(123)` → `.tra` files

**Translation file resolution**: Checks `/** @tra filename */` comment in first line, falls back to auto-matching by basename if `auto_tra` setting is enabled.

**Inlay hints**: Shows truncated string previews (max 30 chars) as inline `/* text */` comments after each reference. Tooltip shows full text if truncated.

**Find references**: From a `.tra`/`.msg` file, finds all usages of an entry across consumer files. Cursor can be on the entry number or anywhere in the value (including multiline). Uses a reverse index (`traFileKey → Set<consumerPath>`) built at startup and updated on document open/save/change. Consumer files are matched by `@tra` comment or basename convention.

**Caching**: All `.tra`/`.msg` files in configured translation directory loaded at startup. Updated incrementally on file save/change. The consumer reverse index is updated atomically with the forward index.

### Rename (Scope-Aware)

Rename uses a three-module pipeline: `symbol-scope.ts` → `reference-finder.ts` → `rename.ts`.

**Scope determination** (`symbol-scope.ts`): Given a cursor position, determines whether
the symbol is file-scoped (procedure name, macro, export) or procedure-scoped (param,
variable, for/foreach var). Returns `SslSymbolScope` with the scope type and, for
procedure-scoped symbols, the containing procedure node.

**Reference finding** (`reference-finder.ts`): Collects all identifier references within
the correct scope. For procedure-scoped symbols, walks only the procedure subtree. For
file-scoped symbols, walks the entire tree but skips procedures that shadow the name
with a local definition, skips `macro_params` nodes (which contain real identifier children),
and skips macro bodies where the symbol name matches a macro parameter (parameter shadowing).

### Cross-File References

The `ReferencesIndex` (`shared/references-index.ts`) enables workspace-wide Find References
without scanning all files on each request. It maps `symbolName -> uri -> Location[]`.

```
Startup / File Change
       |
       v
+------------------+     +------------------+
| call-sites.ts    | --> | ReferencesIndex  |
| (per-language    |     | .updateFile()    |
|  AST extractor)  |     +------------------+
+------------------+

Find References Request
       |
       v
+------------------+     +------------------+
| references.ts    | --> | ReferencesIndex  |
| (single-file     |     | .lookup()        |
|  analysis)       |     +------------------+
+------------------+
       |
       v
  Merge local + cross-file results
```

**Per-language call-site extractors** (`call-sites.ts`):

- **SSL**: Collects all `Identifier` nodes grouped by name. Cross-file lookup uses exact match.
- **TP2**: Collects `FUNCTION_DEF_TYPES` and `FUNCTION_CALL_TYPES` name fields. Keys are case-sensitive. Variables are not indexed — they are function/loop-scoped.
- **D**: Collects state label references with `dialogFile:labelName` composite keys. Dialog files are normalized to lowercase. Workspace symbols use the same dialog-scoped key so labels like `0` remain distinguishable in multi-dialog files.

**Index population**: Populated uniformly by `ProviderRegistry` using each provider's `indexExtensions`. The same extension list drives startup scan, watched-file create/change/delete handling, and provider reload cleanup. Open documents still update incrementally via `onDidChangeContent`.

**Workspace symbol routing**: The server still supports global aggregation, but the VS Code client now scopes `workspace/symbol` queries to the active editor language for `fallout-ssl`, `weidu-d`, and `weidu-tp2`. This avoids cross-language pollution in Ctrl+T while preserving the registry's global fallback behavior for other clients.

**Scoping**: Only file-scoped symbols get cross-file results. Procedure-local variables (SSL), function/loop-scoped variables (TP2), and intra-dialog labels (D) remain single-file only. The `references.ts` module in each language checks the symbol scope before querying the index. For SSL, when a symbol is not defined in the current file (e.g., a macro from an included header), `findReferences` falls back to the ReferencesIndex for cross-file references and file-scope AST search for local occurrences.

**SSL visibility boundary**: SSL indexes both `.h` and `.ssl` files. Header symbols are loaded as `SourceType.Workspace` and are globally visible for fallback hover/definition/rename. Source-file `.ssl` symbols are loaded as `SourceType.Navigation`: they power workspace symbols and cross-file navigation data, but must not participate in global fallback symbol resolution for unrelated scripts.

**Single-file rename** (`rename.ts`): Uses scope info to rename only within the correct scope.

**Workspace-wide rename** (`rename.ts`): For symbols defined in header files:

1. Find the definition URI (local AST or symbol store lookup)
2. Query `refsIndex.lookupUris(symbolName)` for all files that reference the name
3. For each candidate file, use scope-aware reference finding (skips procedure-local shadows)
4. Skip files that redefine the symbol at file scope (a different procedure/macro with same name)
5. Return `documentChanges` (TextDocumentEdit[]) for atomic cross-file undo

Uses the same `ReferencesIndex` as Find References rather than a separate include graph.
This handles cases where headers use symbols they don't directly `#include` — e.g., `den.h`
uses `GVAR_DEN_GANGWAR` from `global.h`, relying on `.ssl` files to include both.

## Key Design Decisions

Moved to [`docs/architecture.md`](../docs/architecture.md#key-design-decisions) — see that document for the consolidated design decisions, including tree-sitter error recovery defenses, URI normalization, and per-language implementation rationale.

## Static Data Pipeline

```
+------------------+     +------------------+     +------------------+
| YAML data files  | --> | generate-data.ts | --> | completion.      |
| (game functions) |     | (shared building |     | {lang}.json      |
|                  |     |  blocks)         |     | (pre-formatted)  |
+------------------+     +------------------+     +------------------+
                                                         |
                                                         v
                                                  +------------------+
                                                  | loadStaticSymbols|
                                                  +------------------+
                                                         |
                                                         v
                                                  +------------------+
                                                  | Symbols          |
                                                  | .loadStatic()    |
                                                  +------------------+
```

All formatting is pre-computed at build time by `generate-data.ts`. WeiDU/TP2 items use `buildWeiduHoverContent()` — the same composition function used by runtime JSDoc hover formatters — ensuring identical output. Fallout items use the lower-level building blocks (`buildSignatureBlock`, `buildFalloutArgsTable`, `formatDeprecation`) directly. The static loader is a pure pass-through — no runtime transforms. See `server/data/README.md` for the YAML schema and formatting pipeline.

**Engine procedure hover enrichment (Fallout SSL only):** `extract-engine-proc-docs.ts` reads the `engine_procedures` stanza from `fallout-ssl-base.yml` and writes `fallout-ssl-engine-proc-docs.json` — a name→doc map. `local-symbols.ts` imports this at bundle time and passes the doc to `buildProcedureSymbol` for any engine procedure name. The engine doc is appended after user JSDoc (separated by `---`), or shown alone if the user wrote no JSDoc. This enriches the local hover without touching the static symbol pipeline.

## Testing

See [scripts/README.md](../scripts/README.md) for all test commands.

### Test layers

| Layer             | Config                         | What it covers                                                                                                                                                                        | Fixtures                                         |
| ----------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Unit tests        | `vitest.config.ts`             | Pure logic, utilities, parsers, transpilers                                                                                                                                           | Inline strings                                   |
| Integration tests | `vitest.integration.config.ts` | AST-derived LSP features (symbols, definition, references, rename, folding, formatting, signature, hover, local symbols, workspace symbols, completion context) against real mod code | `external/` repos (cloned by `test-external.sh`) |
| Smoke test        | `vitest.smoke.config.ts`       | Server starts and responds over stdio                                                                                                                                                 | Built server bundle                              |

Integration tests live in `test/integration/` and cover SSL, BAF, D, and TP2. They test all AST-derived LSP features: symbols, definition, references, rename, folding, formatting, signature, hover (JSDoc), local symbols, workspace symbols, and completion context. Static-data-only features (completion/hover from YAML) are covered by unit tests.

The shared LSP connection mock is in `test/integration/setup.ts`, loaded via `setupFiles` in the integration config.

### Coverage scope

Unit coverage measures every source file the tests actually import, with two exclusions:

- `src/**/format/**/*.ts` — tree-sitter format sub-modules that operate on parsed AST nodes. Exercised by grammar-corpus tests (`grammars/*/test/corpus`), not unit tests. Top-level format orchestrators (`infinity-2da/format.ts`, `weidu-tra/format.ts`, `fallout-msg/format.ts`) remain unit-tested and measured.
- `src/fallout-ssl/provider.ts`, `src/weidu-tp2/provider.ts` — LSP dispatcher glue whose methods delegate to unit-tested sub-modules. End-to-end behaviour is verified by `test/integration/` against real mod files.

Thresholds: 90% lines, 80% branches, 90% functions, 90% statements — enforced by `pnpm exec vitest run --coverage`.

## Adding a New Provider

1. Add language ID to `core/languages.ts`
2. Create tree-sitter grammar in `grammars/{lang}/`
3. Add `@asgerf/dts-tree-sitter` devDependency and `generate:types` script to grammar's `package.json`
4. Run `pnpm generate:types` to create `tree-sitter.d.ts` with `SyntaxType` enum
5. Run `pnpm build:grammar` to compile WASM
6. Register the parser in `server.ts` via `parserManager.register(LANG_ID, "tree-sitter-{lang}.wasm", "Name")`
7. Create `src/{lang}/parser.ts` as a thin re-export from `ParserManager` (see existing parser.ts files)
8. Create `src/{lang}/provider.ts` implementing `ProviderBase` and the relevant capability interfaces (e.g., `FormattingCapability`, `CompletionCapability`)
9. Register provider in `server.ts` via `registry.register(provider)`
10. Add static data to `data/{lang}.yml` (if needed)

## Performance Considerations

- **Parse caching**: 10-entry LRU cache avoids re-parsing
- **Debounced reload**: 300ms delay on document changes
- **Pre-computed responses**: No computation on LSP requests
- **File-level updates**: Only changed file re-indexed
- **Sequential init**: Required by tree-sitter, adds ~100ms startup
