# Tree-sitter Grammars

See also: [CONTRIBUTING.md](../CONTRIBUTING.md) | [docs/architecture.md](../docs/architecture.md) | [scripts/README.md](../scripts/README.md)

Six tree-sitter grammars for the supported languages. Four are used by the LSP server for parsing (formatting, symbols, etc.), two are highlight-only for external editors.

| Grammar       | Language                        | Used By                                                  |
| ------------- | ------------------------------- | -------------------------------------------------------- |
| `fallout-ssl` | Fallout SSL (.ssl, .h)          | LSP provider (format, symbols, definition, rename, etc.) |
| `weidu-baf`   | WeiDU BAF (.baf)                | LSP provider (format, folding)                           |
| `weidu-d`     | WeiDU D (.d)                    | LSP provider (format, symbols, definition, folding)      |
| `weidu-tp2`   | WeiDU TP2 (.tp2/.tpa/.tph/.tpp) | LSP provider (format, symbols, definition, rename, etc.) |
| `fallout-msg` | Fallout MSG (.msg)              | Highlighting only (Neovim, Helix, Zed, Emacs)            |
| `weidu-tra`   | WeiDU TRA (.tra)                | Highlighting only (Neovim, Helix, Zed, Emacs)            |

## Building

```bash
pnpm build:grammar        # Build all grammars to WASM
cd grammars/weidu-tp2 && pnpm test   # Test a single grammar
pnpm test:grammars        # Test all grammars
```

Or manually for a single grammar:

```bash
cd grammars/fallout-ssl
tree-sitter generate
tree-sitter build --wasm
```

## Why WASM?

We use `web-tree-sitter` (WASM) instead of native `tree-sitter` bindings because:

1. **Portability** -- WASM works on all platforms without recompilation
2. **No native dependencies** -- Users don't need node-gyp, Python, or C++ build tools
3. **Node.js compatibility** -- Native tree-sitter lacks prebuilds for newer Node versions
4. **Simpler distribution** -- Just ship the `.wasm` file, no platform-specific binaries

## Deployment

WASM files are copied to `server/out/` by `scripts/build-base-server.sh` during build:

- `web-tree-sitter.wasm` -- core parser runtime
- `tree-sitter-ssl.wasm` -- Fallout SSL grammar
- `tree-sitter-baf.wasm` -- WeiDU BAF grammar
- `tree-sitter-weidu_d.wasm` -- WeiDU D grammar
- `tree-sitter-weidu_tp2.wasm` -- WeiDU TP2 grammar

The MSG and TRA grammars are not bundled (no LSP provider uses them). They are built for external editors that install tree-sitter grammars natively.

## Highlight Queries

Each grammar has a `queries/highlights.scm` file following Neovim capture name conventions. These are used by Neovim, Helix, Zed, and Emacs for tree-sitter highlighting. See the [editor setup docs](../docs/editors/) for installation instructions.

## Type Generation

All four LSP server grammars (fallout-ssl, weidu-baf, weidu-d, weidu-tp2) generate `SyntaxType` enums via `@asgerf/dts-tree-sitter`:

```bash
cd grammars/fallout-ssl && pnpm generate:types
```

This copies the generated `tree-sitter.d.ts` to `server/src/{lang}/` for type-safe AST node comparisons. Runs automatically for all four grammars as part of `pnpm build:grammar`.
