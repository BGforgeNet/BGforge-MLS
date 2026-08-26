#!/bin/bash

# Test client - typecheck and formatting
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$CLIENT_DIR"

echo "=== Typechecking client ==="
pnpm exec tsc --noEmit

echo ""
echo "=== Checking formatting ==="
# The whole package, not just src: oxfmt's own ignore config decides what is excluded, and naming a
# directory here quietly scoped the check to source while the repo-wide gate read the tests too.
pnpm exec oxfmt --check .

echo ""
echo "SUCCESS: All client tests passed"
