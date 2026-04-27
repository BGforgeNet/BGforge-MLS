#!/bin/bash

# Post-build hook for @bgforge/format: copies tree-sitter WASM files next to
# format/out/cli.js so the CLI can load them via __dirname at runtime.
# Invoked by tsup's onSuccess hook in format/tsup.config.ts.
# Must run from the repo root so grammars/ and server/node_modules/ are reachable.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/esbuild-lib.sh
source "$SCRIPT_DIR/esbuild-lib.sh"

copy_wasm_to format/out
