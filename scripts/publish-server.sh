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

# Preflight: the published server resolves its @bgforge/format workspace dep to format's
# concrete version, so that version must already be on npm or a fresh `npm install
# @bgforge/mls-server` cannot resolve it. The libraries release independently on their own
# <lib>/vX.Y.Z tags (publish-library.yml), so fail fast if format was bumped here without
# its tag being released first.
format_version="$(node -p "require('./format/package.json').version")"
if ! pnpm view "@bgforge/format@${format_version}" version >/dev/null 2>&1; then
    echo "Error: @bgforge/format@${format_version} is not published on npm." >&2
    echo "Release the format/v${format_version} tag before this server publish." >&2
    exit 1
fi

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
