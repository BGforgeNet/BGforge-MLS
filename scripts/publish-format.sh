#!/bin/bash

# Build and publish the @bgforge/format package (library + fgfmt bin) to npm.
# Usage: ./scripts/publish-format.sh [--dry-run]
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

# shellcheck source=scripts/publish-lib.sh
source "$SCRIPT_DIR/publish-lib.sh"

if [ "${SKIP_BUILD:-}" != "1" ]; then
    echo "=== Building @bgforge/format ==="
    pnpm build:format
fi

do_publish "@bgforge/format" format "$@"
