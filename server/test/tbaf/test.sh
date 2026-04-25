#!/bin/bash

# TBAF transpiler integration tests.
# 1. TypeScript typecheck (source validity)
# 2. Transpile and compare against expected .baf files

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
ROOT="$(cd ../../../ && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT/transpilers/package.json")"

if [[ ! -f "$CLI" ]]; then
    echo "Missing transpile CLI bundle: $CLI"
    exit 1
fi

# --- Phase 1: TypeScript typecheck ---
echo "=== TBAF TypeScript Check ==="
./typecheck-samples.sh

# --- Phase 2: Transpile and diff ---
echo ""
echo "=== TBAF Transpile Tests ==="

fail=0
pass=0

# Transpile all samples in one batch to a temp dir
tmpdir="$ROOT/tmp/server-test-tbaf"
rm -rf "$tmpdir"
mkdir -p "$tmpdir"

for sample in samples/*.tbaf; do
    name=$(basename "$sample" .tbaf)
    cp "$sample" "$tmpdir/${name}.tbaf"
done

# Batch transpile (single node process)
node --no-warnings "$CLI" "$tmpdir" -r --save -q 2>&1

for sample in samples/*.tbaf; do
    name=$(basename "$sample" .tbaf)
    expected="samples-expected/${name}.baf"
    actual="$tmpdir/${name}.baf"

    if [[ ! -f "$expected" ]]; then
        echo "FAIL: $name (no expected file)"
        fail=$((fail + 1))
        continue
    fi

    if [[ ! -f "$actual" ]]; then
        echo "FAIL: $name (no output produced)"
        fail=$((fail + 1))
        continue
    fi

    # Check output matches expected
    if ! diff -q "$expected" "$actual" >/dev/null 2>&1; then
        echo "FAIL: $name (output mismatch)"
        diff "$expected" "$actual" || true
        fail=$((fail + 1))
        continue
    fi

    echo "PASS: $name"
    pass=$((pass + 1))
done

rm -rf "$tmpdir"

echo ""
echo "TBAF tests: $pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
    exit 1
fi
