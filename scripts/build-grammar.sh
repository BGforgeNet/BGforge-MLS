#!/bin/bash

# Build tree-sitter grammars to WASM and set up files for both production and testing.
# WASM builds run sequentially because tree-sitter shares a global wasi-sdk cache and
# concurrent downloads/extracts can corrupt the archive on a cold cache. After building,
# copy WASM files to server/out/ and cli/format/out/, then create symlinks in
# server/src/shared/ so vitest can find them via __dirname resolution.

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

mkdir -p server/out cli/format/out

TREE_SITTER="$ROOT_DIR/node_modules/.bin/tree-sitter"

# Build all 4 grammars sequentially. tree-sitter uses a shared cache under
# ~/.cache/tree-sitter for wasi-sdk, so parallel --wasm builds can race and leave
# a truncated archive behind.
step "Building grammar WASMs"
for dir in fallout-ssl weidu-baf weidu-d weidu-tp2; do
    echo "[$dir]"
    (
        cd "$ROOT_DIR/grammars/$dir"
        "$TREE_SITTER" generate
        "$TREE_SITTER" build --wasm
    )
done

# Copy WASM files to server and CLI output directories (sequential — depends on all builds)
for dir in fallout-ssl weidu-baf weidu-d weidu-tp2; do
    cp "grammars/$dir"/*.wasm server/out/
    cp "grammars/$dir"/*.wasm cli/format/out/
done

# Copy web-tree-sitter runtime WASM (needed by parser-factory.ts)
cp server/node_modules/web-tree-sitter/web-tree-sitter.wasm server/out/

# Create symlinks in server/src/shared/ for vitest.
# vitest resolves __dirname to the source directory (server/src/shared/), not the
# build output (server/out/). These symlinks let parser-factory.ts find WASM files
# during testing without a full build.
for wasm in server/out/*.wasm; do
    target="server/src/shared/$(basename "$wasm")"
    ln -sf "../../out/$(basename "$wasm")" "$target"
done

# Generate SyntaxType enums for all LSP grammars in parallel.
# dts-tree-sitter is a per-grammar devDependency, not hoisted to the workspace root.
# Post-process `export const enum` -> `export enum` because verbatimModuleSyntax
# in tsconfig.base.json forbids const-enum exports.
step "Generating type definitions"
parallel \
    "types:fallout-ssl" "cd '$ROOT_DIR/grammars/fallout-ssl' && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/fallout-ssl/tree-sitter.d.ts'" \
    "types:weidu-baf"   "cd '$ROOT_DIR/grammars/weidu-baf'   && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-baf/tree-sitter.d.ts'" \
    "types:weidu-d"     "cd '$ROOT_DIR/grammars/weidu-d'     && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-d/tree-sitter.d.ts'" \
    "types:weidu-tp2"   "cd '$ROOT_DIR/grammars/weidu-tp2'   && ./node_modules/.bin/dts-tree-sitter . | sed 's/export const enum /export enum /' > src/tree-sitter.d.ts && cp src/tree-sitter.d.ts '$ROOT_DIR/server/src/weidu-tp2/tree-sitter.d.ts'"

timing_summary "Grammar build complete"
