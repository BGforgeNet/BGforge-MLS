#!/bin/bash

set -eu -o pipefail

# Build webview bundles (binary .pro editor, dialog tree preview).
# Forwards args (--sourcemap, --minify) to esbuild.
esbuild \
  ./client/src/editors/binaryEditor-webview.ts \
  ./client/src/dialog-tree/dialogTree-webview.ts \
  --outdir=client/out \
  --bundle \
  "$@"
