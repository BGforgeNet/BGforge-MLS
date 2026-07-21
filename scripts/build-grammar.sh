#!/bin/bash

# Build tree-sitter grammars to WASM and set up files for both production and testing.
# WASM builds run sequentially because tree-sitter shares a global wasi-sdk cache and
# concurrent downloads/extracts can corrupt the archive on a cold cache. After building,
# copy WASM files to server/out/ and format/out/ (the format package's CLI bundle), then
# create symlinks in shared/parsers/ so vitest can find them via __dirname resolution
# (shared/parsers/parser-factory.ts is the cross-package home for parser infrastructure).

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/grammar-build-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# shellcheck source=scripts/grammar-generate-lib.sh
source "$SCRIPT_DIR/grammar-generate-lib.sh"

mkdir -p server/out format/out

TREE_SITTER="$ROOT_DIR/node_modules/.bin/tree-sitter"

# LSP grammars: parsed at runtime, formatted by the @bgforge/format CLI, and the
# source of generated SyntaxType enums (providers key on their node types).
LSP_GRAMMARS=(fallout-ssl weidu-baf weidu-d weidu-tp2)
# Diagnostics-only grammars: parsed at runtime solely to surface parse errors as
# diagnostics. Their formatters are string-based (not tree-sitter) and no provider
# keys on their node types, so they ship only to server/out - no format/out copy
# and no SyntaxType generation.
DIAG_GRAMMARS=(fallout-msg weidu-tra)

# Build all grammars sequentially. tree-sitter uses a shared cache under
# ~/.cache/tree-sitter for wasi-sdk, so parallel --wasm builds can race and leave
# a truncated archive behind.
step "Building grammar WASMs"
for dir in "${LSP_GRAMMARS[@]}" "${DIAG_GRAMMARS[@]}"; do
    echo "[$dir]"
    generate_grammar_cached "$ROOT_DIR/grammars/$dir" "$TREE_SITTER"
    (
        cd "$ROOT_DIR/grammars/$dir"
        "$TREE_SITTER" build --wasm
    )
done

# LSP grammar WASMs go to both the server and the format CLI bundle.
for dir in "${LSP_GRAMMARS[@]}"; do
    cp "grammars/$dir"/*.wasm server/out/
    cp "grammars/$dir"/*.wasm format/out/
done
# Diagnostics-only grammar WASMs are loaded by the server only.
for dir in "${DIAG_GRAMMARS[@]}"; do
    cp "grammars/$dir"/*.wasm server/out/
done

# Copy web-tree-sitter runtime WASM (needed by parser-factory.ts)
cp server/node_modules/web-tree-sitter/web-tree-sitter.wasm server/out/

# Create symlinks in shared/parsers/ for vitest.
# vitest resolves __dirname to the source directory (shared/parsers/), not the
# build output (server/out/). These symlinks let parser-factory.ts find WASM files
# during testing without a full build. Pointing into server/out/ couples the symlink
# target but not the source - shared/parsers/ stays free of server-specific imports.
mkdir -p shared/parsers
for wasm in server/out/*.wasm; do
    target="shared/parsers/$(basename "$wasm")"
    ln -sf "../../server/out/$(basename "$wasm")" "$target"
done

# Generate SyntaxType enums for all LSP grammars in parallel.
# dts-tree-sitter is a per-grammar devDependency, not hoisted to the workspace root.
# Post-process `export const enum` -> `export enum` because verbatimModuleSyntax
# in tsconfig.base.json forbids const-enum exports.
step "Generating type definitions"
parallel \
    "types:fallout-ssl" "cd '$ROOT_DIR/grammars/fallout-ssl' && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && node '$ROOT_DIR/scripts/split-syntax-type.mjs' src/tree-sitter.d.ts src/syntax-type.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/fallout-ssl/' && cp src/syntax-type.ts '$ROOT_DIR/shared/syntax-types/fallout-ssl.ts'" \
    "types:weidu-baf" "cd '$ROOT_DIR/grammars/weidu-baf'   && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && node '$ROOT_DIR/scripts/split-syntax-type.mjs' src/tree-sitter.d.ts src/syntax-type.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-baf/' && cp src/syntax-type.ts '$ROOT_DIR/shared/syntax-types/weidu-baf.ts'" \
    "types:weidu-d" "cd '$ROOT_DIR/grammars/weidu-d'     && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && node '$ROOT_DIR/scripts/split-syntax-type.mjs' src/tree-sitter.d.ts src/syntax-type.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-d/' && cp src/syntax-type.ts '$ROOT_DIR/shared/syntax-types/weidu-d.ts'" \
    "types:weidu-tp2" "cd '$ROOT_DIR/grammars/weidu-tp2'   && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && node '$ROOT_DIR/scripts/split-syntax-type.mjs' src/tree-sitter.d.ts src/syntax-type.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-tp2/' && cp src/syntax-type.ts '$ROOT_DIR/shared/syntax-types/weidu-tp2.ts'"

timing_summary "Grammar build complete"
