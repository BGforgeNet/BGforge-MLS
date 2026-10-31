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
    # SKIP_GRAMMAR_BUILD=1 means the caller already built the WASMs, which the CI
    # dispatcher does so they exist for the test gate it runs before this script.
    if [ "${SKIP_GRAMMAR_BUILD:-}" != "1" ]; then
        echo "=== Building tree-sitter grammars (format bundles their WASM) ==="
        pnpm build:grammar
        # The only tracked files build:grammar regenerates are the SyntaxType enums in
        # shared/syntax-types (the rest of its output is gitignored). A difference means
        # the committed enums are stale; publishing must not hide that by restoring them.
        drifted="$(git diff --name-only -- shared/syntax-types)"
        if [ -n "$drifted" ]; then
            echo "Error: build:grammar regenerated these tracked files differently from the committed ones:" >&2
            echo "$drifted" >&2
            echo "Commit the regenerated files (or fix the grammar) before publishing." >&2
            exit 1
        fi
    fi
    echo "=== Building @bgforge/format ==="
    pnpm build:format
fi

do_publish "@bgforge/format" format "$@"
