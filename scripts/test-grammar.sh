#!/bin/bash

# Test a single grammar: generate, lint, corpus, parse, format, compare, idempotency.
# Usage: ./scripts/test-grammar.sh <grammar-name>

set -eu -o pipefail

GRAMMAR_NAME="${1:?Usage: $0 <grammar-name>}"

# shellcheck source=scripts/grammar-test-lib.sh
source "$(dirname "$0")/grammar-test-lib.sh"

grammar_generate
grammar_build_wasm
grammar_lint
grammar_corpus
grammar_highlight
grammar_parse
grammar_build_format
grammar_format
grammar_compare
grammar_success
