#!/bin/bash

# TD transpiler integration tests.
# 1. TypeScript typecheck (source validity)
# 2. Transpile and compare against expected .d files
# 3. Parse-check the emitted .d with WeiDU itself

set -e

# Phase 3 bound. A wedged child would otherwise hang the whole gate with no failing test to name it.
readonly WEIDU_TIMEOUT_SECONDS=30

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
ROOT="$(cd ../../../ && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT/transpilers/package.json")"

if [[ ! -f "$CLI" ]]; then
    echo "Missing transpile CLI bundle: $CLI"
    exit 1
fi

# --- Phase 1: TypeScript typecheck ---
echo "=== TD TypeScript Check ==="
./typecheck-samples.sh

# --- Phase 2: Transpile and diff ---
echo ""
echo "=== TD Transpile Tests ==="

fail=0
pass=0

# Transpile all samples in one batch to a temp dir
tmpdir="$ROOT/tmp/server-test-td"
rm -rf "$tmpdir"
mkdir -p "$tmpdir"

for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    cp "$sample" "$tmpdir/${name}.td"
done

# Batch transpile (single node process)
node --no-warnings "$CLI" "$tmpdir" -r --save -q 2>&1

for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    expected="samples-expected/${name}.d"
    actual="$tmpdir/${name}.d"

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

# --- Phase 3: parse-check the emitted .d against WeiDU ---
# The expected files diffed above are this transpiler's own output, so they pin whatever it emits
# today - a construct WeiDU rejects is baked into the oracle rather than caught by it. WeiDU is the
# authority on what .d syntax is legal, so every emitted file is checked against it directly.
echo ""
echo "=== TD WeiDU parse-check ==="

# No skip path: a gate that passes by never running is worse than no gate. When the caller has not
# already exported one, provision the pinned checksum-verified binary the same way scripts/test.sh,
# test-all.sh and CI do; ensure-weidu.sh failing aborts the run rather than skipping it.
weidu_bin="${WEIDU_BIN:-}"
if [[ -z "$weidu_bin" ]] || ! command -v "$weidu_bin" >/dev/null; then
    weidu_bin="$("$ROOT/scripts/ensure-weidu.sh")"
fi

for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    actual="$tmpdir/${name}.d"
    [[ -f "$actual" ]] || continue

    # Captured rather than discarded: on a rejection WeiDU's message is the whole diagnostic, and
    # an unrunnable binary must not read the same as a parse error. WeiDU exits 4 on the latter.
    weidu_status=0
    weidu_out=$(timeout "$WEIDU_TIMEOUT_SECONDS" "$weidu_bin" \
        --nogame --noautoupdate --parse-check d "$actual" 2>&1 </dev/null) || weidu_status=$?

    if [[ $weidu_status -eq 0 ]]; then
        echo "PASS: $name (weidu)"
    else
        echo "FAIL: $name (weidu rejected the emitted .d; exit $weidu_status)"
        echo "$weidu_out" | head -5
        fail=$((fail + 1))
    fi
done

rm -rf "$tmpdir"

echo ""
echo "TD tests: $pass passed, $fail failed"

if [[ $fail -gt 0 ]]; then
    exit 1
fi
