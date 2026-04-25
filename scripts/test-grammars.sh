#!/bin/bash

# Run grammar tests for all grammars. Builds format CLI once, then tests
# all grammars in parallel (they are independent).

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/grammar-test-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

step "Building format CLI"
pnpm build:format

export SKIP_FORMAT_BUILD=1

step "Testing grammars"
parallel \
    "fallout-ssl" "$SCRIPT_DIR/test-grammar.sh fallout-ssl" \
    "weidu-baf"   "$SCRIPT_DIR/test-grammar.sh weidu-baf" \
    "weidu-d"     "$SCRIPT_DIR/test-grammar.sh weidu-d" \
    "weidu-tp2"   "$SCRIPT_DIR/test-grammar.sh weidu-tp2" \
    "weidu-tra"   "$SCRIPT_DIR/test-grammar.sh weidu-tra" \
    "fallout-msg" "$SCRIPT_DIR/test-grammar.sh fallout-msg"

timing_summary "All grammar tests passed"
