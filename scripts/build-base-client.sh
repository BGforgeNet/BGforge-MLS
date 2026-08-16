#!/bin/bash

set -eu -o pipefail

# shellcheck source=scripts/esbuild-lib.sh
source "$(dirname "$0")/esbuild-lib.sh"

# Build client extension bundle. Forwards args (--sourcemap, --minify, --watch) to esbuild.
# The __imu shim is needed because the compiled-script editor loads web-tree-sitter to compile a saved
# script, and its Emscripten glue resolves paths through import.meta.url - which esbuild's CJS output
# otherwise shims to an empty object, so the read is handed undefined and only fails at save time.
esbuild ./client/src/extension.ts \
    --bundle \
    --outfile=client/out/extension.js \
    --external:vscode \
    --format=cjs \
    --platform=node \
    --banner:js="$imu_banner" \
    "$imu_define" \
    "$@"

# Binary-editor worker bundle (runs in the extension host via worker_threads).
esbuild ./client/src/binary-editor/worker.ts \
    --bundle \
    --outfile=client/out/binary-editor/worker.js \
    --external:vscode \
    --format=cjs \
    --platform=node \
    "$@"

# Copy codicons font assets for webview usage
mkdir -p client/out/codicons
cp node_modules/@vscode/codicons/dist/codicon.css \
    node_modules/@vscode/codicons/dist/codicon.ttf \
    client/out/codicons/
