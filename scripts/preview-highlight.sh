#!/bin/bash

# Preview tree-sitter highlighting for a grammar's sample files.
# Creates a temporary symlink so the CLI can discover the grammar,
# runs `tree-sitter highlight`, then cleans up.
#
# Usage: ./scripts/preview-highlight.sh <grammar-name> [file]
#   grammar-name: fallout-ssl, weidu-baf, weidu-d, weidu-tp2
#   file: optional file to highlight (default: first test/highlight/* file)

set -eu -o pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TS="$ROOT_DIR/node_modules/.bin/tree-sitter"
GRAMMAR_NAME="${1:?Usage: $0 <grammar-name> [file]}"
GRAMMAR_DIR="$ROOT_DIR/grammars/$GRAMMAR_NAME"

case "$GRAMMAR_NAME" in
    fallout-ssl) LINK_NAME="tree-sitter-ssl" ;;
    weidu-baf) LINK_NAME="tree-sitter-baf" ;;
    weidu-d) LINK_NAME="tree-sitter-weidu_d" ;;
    weidu-tp2) LINK_NAME="tree-sitter-weidu_tp2" ;;
    *)
        echo "Unknown grammar: $GRAMMAR_NAME"
        exit 1
        ;;
esac

LINK_PATH="$ROOT_DIR/grammars/$LINK_NAME"

if [[ -n "${2:-}" ]]; then
    FILE="$(realpath "$2")"
else
    FILE=$(find "$GRAMMAR_DIR/test/highlight" -type f | head -n1)
    if [[ -z "$FILE" ]]; then
        echo "No highlight test files found in $GRAMMAR_DIR/test/highlight/"
        exit 1
    fi
fi

# Create symlink, highlight, clean up
ln -sfn "$GRAMMAR_NAME" "$LINK_PATH"
trap 'rm -f "$LINK_PATH"' EXIT

cd "$GRAMMAR_DIR"
"$TS" highlight "$FILE"
