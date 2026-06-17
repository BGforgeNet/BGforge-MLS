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
    # format bundles the tree-sitter grammar WASMs (its formatters parse with
    # tree-sitter), and the format build's postbuild copies them into out/. The
    # lean publish workflow only runs `pnpm install`, so the WASMs must be built
    # here first or the postbuild copy fails.
    echo "=== Building tree-sitter grammars (format bundles their WASM) ==="
    pnpm build:grammar
    # build:grammar also regenerates tracked grammar sources/types (tree-sitter
    # generate + generate:types). With pinned tree-sitter these match what is
    # committed, but restore tracked files anyway so any regen drift cannot leave
    # the tree dirty and trip do_publish's clean-tree guard. The gitignored WASM
    # artifacts it produced are untracked and survive the restore.
    git checkout -- .
    echo "=== Building @bgforge/format ==="
    pnpm build:format
fi

do_publish "@bgforge/format" format "$@"
