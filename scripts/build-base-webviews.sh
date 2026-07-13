#!/bin/bash

set -eu -o pipefail

# Build webview bundles (binary editor [Svelte], dialog editor) via esbuild's JS API
# so the esbuild-svelte plugin can run (the CLI cannot load plugins). Forwards --sourcemap/--minify.
node ./scripts/build-webviews.mjs "$@"
