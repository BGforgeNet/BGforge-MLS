#!/bin/bash

# Build and publish the standalone LSP server package to npm.
# Usage: ./scripts/publish-server.sh [--dry-run]
# Set SKIP_BUILD=1 to skip grammar/data/server build (CI uses this).
#
# Prerequisites:
#   - pnpm install
#   - pnpm login (or NPM_TOKEN set)
#   - @bgforge npm org must exist

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/publish-lib.sh
source "$SCRIPT_DIR/publish-lib.sh"

# No @bgforge/* preflight: the server bundles @bgforge/format and the transpilers into
# server/out/server.js (esbuild externalizes only vscode and rolldown), and format is a
# devDependency, so the published manifest declares no @bgforge/* runtime dependency. A fresh
# `npm install @bgforge/mls-server` resolves nothing from this repo, so the server publishes
# independently of the library tags.

if [ "${SKIP_BUILD:-}" != "1" ]; then
    echo "=== Building grammars ==="
    pnpm build:grammar

    echo ""
    echo "=== Generating static data ==="
    pnpm generate-data

    echo ""
    echo "=== Building server ==="
    pnpm build:base:server --minify
fi

# TS plugins: normal build puts them in node_modules/, npm package needs them in server/out/
echo "=== Building TS plugins into server/out/ ==="
pnpm exec esbuild ./plugins/tssl-plugin/src/index.ts \
    --bundle --outfile=server/out/tssl-plugin.js --format=cjs --platform=node --minify
pnpm exec esbuild ./plugins/td-plugin/src/index.ts \
    --bundle --outfile=server/out/td-plugin.js --format=cjs --platform=node --minify

do_publish "@bgforge/mls-server" server "$@"
