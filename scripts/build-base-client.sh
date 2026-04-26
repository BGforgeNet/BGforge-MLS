#!/bin/bash

set -eu -o pipefail

# Build client extension bundle. Forwards args (--sourcemap, --minify, --watch) to esbuild.
esbuild ./client/src/extension.ts \
  --bundle \
  --outfile=client/out/extension.js \
  --external:vscode \
  --format=cjs \
  --platform=node \
  "$@"

# Copy codicons font assets for webview usage
mkdir -p client/out/codicons
cp node_modules/@vscode/codicons/dist/codicon.css \
   node_modules/@vscode/codicons/dist/codicon.ttf \
   client/out/codicons/
