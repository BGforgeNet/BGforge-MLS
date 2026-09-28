#!/bin/bash

# Build and publish the @bgforge/ssl package (compiler library + ssl bin) to npm.
# Usage: ./scripts/publish-ssl.sh [--dry-run]
# Set SKIP_BUILD=1 to skip the build step (CI uses this).
#
# Prerequisites:
#   - pnpm install
#   - pnpm build:grammar (the build copies the SSL grammar's WASM beside the CLI)
#   - pnpm login (or NPM_TOKEN set)
#   - @bgforge npm org must exist

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/publish-lib.sh
source "$SCRIPT_DIR/publish-lib.sh"

if [ "${SKIP_BUILD:-}" != "1" ]; then
    echo "=== Building @bgforge/ssl ==="
    pnpm build:ssl
fi

do_publish "@bgforge/ssl" compilers/ssl "$@"
