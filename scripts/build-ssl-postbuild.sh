#!/bin/bash

# Post-build hook for @bgforge/ssl: copies the tree-sitter WASM files ssl loads at runtime next to
# compilers/ssl/out/cli.js, which resolves them via __dirname.
# Invoked by tsdown's onSuccess hook in compilers/ssl/tsdown.config.ts.
# Must run from the repo root so grammars/ and server/node_modules/ are reachable.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# Only the SSL grammar, unlike fgfmt's five: this CLI compiles one language.
cp grammars/fallout-ssl/tree-sitter-ssl.wasm compilers/ssl/out/
cp server/node_modules/web-tree-sitter/web-tree-sitter.wasm compilers/ssl/out/
