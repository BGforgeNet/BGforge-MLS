#!/bin/bash

# Regenerate samples-expected/ for a grammar by formatting all sample files.
# Usage: ./scripts/regenerate-expected.sh <grammar-name>

set -eu -o pipefail

GRAMMAR_NAME="${1:?Usage: $0 <grammar-name>}"

# shellcheck source=scripts/grammar-test-lib.sh
source "$(dirname "$0")/grammar-test-lib.sh"

# Same parser-freshness requirement as the gate in test-grammar.sh, and it matters more here: a stale parser
# makes the gate report a wrong verdict, but makes this script write wrong bytes into committed expected output.
grammar_generate
grammar_build_wasm
grammar_build_format
grammar_regenerate_expected
