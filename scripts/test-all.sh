#!/bin/bash

# Run ALL tests: main suite phases 1-2, then all remaining tests in one parallel block.
# This interleaves grammar tests with Phase 3 tests (smoke, samples, external,
# integration, transpile-external), saving ~30s vs running them sequentially.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/test-all-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# Run Phases 1-2 (static analysis, unit tests, CLI builds)
step "Phases 1-2: Static Analysis + Unit Tests + Builds"
TEST_STOP_AFTER_BUILD=1 "$SCRIPT_DIR/test.sh"

# test.sh already reset external repos; propagate the flag so test-external.sh skips
# its own redundant reset (the export inside test.sh doesn't survive the subprocess).
export EXTERNAL_REPOS_CLEAN=1

# All remaining tests in one parallel block.
# Each job only needs CLIs built (done above). Grammar tests build format CLI if missing.
# Keep in sync with test.sh Phase 3 block (this adds grammar + transpile-external jobs).
# External + Integration + Transpile-external are chained: they all touch the same
# external repos and would race if parallelized. The format step modifies .baf files and
# transpile-external checks git-clean status; concurrent access corrupts both. The EXIT
# trap in test-external.sh resets repos between stages.
# test:cli:external joins this chain (not "Sample + CLI tests"): bin-cli tests that read
# from external/fallout/.../maps/ race with test-external.sh's reset trap if run in
# parallel, so they are gated behind RUN_EXTERNAL_CLI_TESTS and skip cleanly in the
# parallel phase.
step "Phase 3 + Extended: All remaining tests"
parallel \
    "Smoke test" "(cd server && pnpm exec vitest run --config vitest.smoke.config.ts)" \
    "Sample + CLI tests" "./server/test/td/test.sh && ./server/test/tbaf/test.sh && pnpm test:cli" \
    "External + Integration + Transpile" "$SCRIPT_DIR/test-external.sh && (cd server && pnpm exec vitest run --config vitest.integration.config.ts) && pnpm test:transpile-external && pnpm test:cli:external" \
    "Grammar tests" "pnpm test:grammars"

timing_summary "All tests passed (full suite)"
