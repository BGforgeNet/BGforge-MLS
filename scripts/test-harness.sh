#!/usr/bin/env bash
#
# Runs the Playwright render/drive harnesses (binary-editor + dialog-editor) as regression checks.
# Each driver mounts the REAL webview bundle in headless Chromium and asserts through PASS/FAIL gates
# (driver-util's makeChecker, clip-gate, and per-driver `failed` counters), exiting non-zero on any
# failure - including uncaught page errors and CSP violations. This is the automated form of the
# manual "render and eyeball" workflow: it catches render/mount/CSP/layout regressions that the
# node/jsdom vitest suites structurally cannot.
#
# playwright is a pinned devDep; the Chromium browser it drives is not (`pnpm exec playwright install
# chromium`, or the harness CI job's step). Two more prerequisites this script does NOT build, so a fresh
# checkout runs them first (the CI job does both as explicit steps):
#   - `pnpm build:grammar` - the dialog edit drivers parse real .d through the gitignored weidu-d WASM.
#   - `pnpm test:external` (or scripts/reset-external.sh) - the binary drivers read fixtures from the
#     gitignored-but-reproducible external/ trees.
#
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

echo "=== Building binary core (drivers run it in Node) ==="
pnpm --filter @bgforge/binary build

echo "=== Building harness bundles (app.html) ==="
pnpm exec tsx binary-editor/test/harness/build.mts
pnpm exec tsx client/src/dialog-editor/test/harness/build.mts

# Every *.mts except the two build scripts is an assertion-bearing driver.
drivers=()
for f in binary-editor/test/harness/*.mts client/src/dialog-editor/test/harness/*.mts; do
    [[ "$f" == */build.mts ]] && continue
    drivers+=("$f")
done

failed=()
for d in "${drivers[@]}"; do
    echo "=== $d ==="
    if pnpm exec tsx "$d"; then
        echo "  ok"
    else
        echo "  FAIL"
        failed+=("$d")
    fi
done

echo
if ((${#failed[@]} > 0)); then
    echo "HARNESS FAILED (${#failed[@]}/${#drivers[@]} drivers):"
    printf '  %s\n' "${failed[@]}"
    exit 1
fi
echo "HARNESS OK: all ${#drivers[@]} drivers passed"
