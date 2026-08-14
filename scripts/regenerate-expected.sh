#!/bin/bash

# Regenerate samples-expected/ for a grammar by formatting all sample files.
# Usage: ./scripts/regenerate-expected.sh <grammar-name>

set -eu -o pipefail

GRAMMAR_NAME="${1:?Usage: $0 <grammar-name>}"

# shellcheck disable=SC2034  # SAMPLE_EXTS used by sourced grammar-test-lib.sh
case "$GRAMMAR_NAME" in
    fallout-ssl) SAMPLE_EXTS=(-name "*.ssl") ;;
    weidu-baf) SAMPLE_EXTS=(-name "*.baf") ;;
    weidu-d) SAMPLE_EXTS=(-name "*.d") ;;
    weidu-tp2) SAMPLE_EXTS=(-name "*.tp2" -o -name "*.tpa" -o -name "*.tph" -o -name "*.tpp") ;;
    weidu-tra) SAMPLE_EXTS=(-name "*.tra") ;;
    fallout-msg) SAMPLE_EXTS=(-name "*.msg") ;;
    *)
        echo "Unknown grammar: $GRAMMAR_NAME"
        exit 1
        ;;
esac

# shellcheck source=scripts/grammar-test-lib.sh
source "$(dirname "$0")/grammar-test-lib.sh"

# Same parser-freshness requirement as the gate in test-grammar.sh, and it matters more here: a stale parser
# makes the gate report a wrong verdict, but makes this script write wrong bytes into committed expected output.
grammar_generate
grammar_build_wasm
grammar_build_format
grammar_regenerate_expected
