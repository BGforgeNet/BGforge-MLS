#!/bin/bash

# Build and publish the @bgforge/binary package (library + fgbin bin) to npm.
# Usage: ./scripts/publish-binary.sh [--dry-run]
# Set SKIP_BUILD=1 to skip the build step (CI uses this).
#
# Prerequisites:
#   - pnpm install
#   - pnpm login (or NPM_TOKEN set)
#   - @bgforge npm org must exist

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [ "${SKIP_BUILD:-}" != "1" ]; then
    echo "=== Building @bgforge/binary ==="
    pnpm build:binary
fi

echo ""
echo "=== Publishing @bgforge/binary ==="
cd binary

provenance=""
if [ -n "${GITHUB_ACTIONS:-}" ]; then
    provenance="--provenance"
fi

if [ -n "$(git status --porcelain)" ]; then
    echo "Error: Git working tree is not clean. Aborting publish."
    git status --short
    exit 1
fi

pnpm publish --access public --no-git-checks $provenance "$@"
