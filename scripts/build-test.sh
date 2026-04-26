#!/bin/bash

set -eu -o pipefail

# Build E2E test bundles for the VS Code extension host.
esbuild ./client/src/test/*.ts \
  --outdir=client/out/test \
  --external:vscode \
  --external:'./reporters/parallel-buffered' \
  --external:'./worker.js' \
  --format=cjs \
  --platform=node \
  --sourcemap \
  --bundle
