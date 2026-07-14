#!/bin/bash

# Test server - typecheck, unit tests, and transpiler samples
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$SERVER_DIR"

echo "=== Typechecking server ==="
pnpm exec tsc --noEmit

echo ""
echo "=== Running unit tests ==="
pnpm test:unit

echo ""
# Each transpiler's test.sh runs its own typecheck-samples.sh (Phase 1) then diffs
# the transpiler output against the golden samples-expected/ fixtures (Phase 2).
echo "=== Testing TD samples ==="
./test/td/test.sh

echo ""
echo "=== Testing TBAF samples ==="
./test/tbaf/test.sh

echo ""
echo "=== Testing TSSL samples ==="
./test/tssl/transpile/test.sh

echo ""
echo "SUCCESS: All server tests passed"
