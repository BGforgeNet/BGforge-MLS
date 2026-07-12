#!/bin/bash
# Generate corpus tests from sample files by parsing them and capturing AST
# Usage: Run from within a grammar directory (e.g., grammars/weidu-d/)

set -eu -o pipefail

GRAMMAR_DIR="${1:-.}"

cd "$GRAMMAR_DIR"

# Detect file extension from samples directory
if [ ! -d "test/samples" ]; then
    echo "Error: test/samples directory not found in $GRAMMAR_DIR"
    exit 1
fi

# Get first sample file to detect extension
SAMPLE_FILE=$(find test/samples -maxdepth 1 -type f 2>/dev/null | head -1)
if [ -z "$SAMPLE_FILE" ]; then
    echo "Error: No sample files found in test/samples/"
    exit 1
fi

EXT="${SAMPLE_FILE##*.}"
echo "Detected file extension: .$EXT"

OUTPUT_FILE="test/corpus/samples.txt"
mkdir -p test/corpus
true >"$OUTPUT_FILE"

for f in test/samples/*."$EXT"; do
    basename=$(basename "$f" ."$EXT")

    echo "Adding corpus test: $basename"

    {
        echo "================================================================================"
        echo "$basename"
        echo "================================================================================"
        echo ""
        cat "$f"
        echo ""
        echo "--------------------------------------------------------------------------------"
        echo ""
        tree-sitter parse --no-ranges "$f" 2>&1
        echo ""
    } >>"$OUTPUT_FILE"
done

echo "Generated corpus tests in $OUTPUT_FILE"
