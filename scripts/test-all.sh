#!/bin/bash

# Run ALL tests: main suite phases 1-2, then all remaining tests in one parallel block.
# This interleaves grammar tests with Phase 3 tests (smoke, samples, external,
# integration, transpile-external), which is faster than running them sequentially.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# This is the close-out gate, so a suite gated on a build artifact must fail rather than skip when the
# artifact is missing: a silently shrunken run reports the same green as a complete one. The dev-loop
# tier (test.sh) leaves it unset and skips loudly instead. See shared/cli/test/built-artifacts.ts.
export MLS_REQUIRE_BUILT_ARTIFACTS=1

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/test-all-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# Run Phases 1-2 (static analysis, unit tests, CLI builds).
# TEST_COVERAGE=1: the coverage thresholds are enforced here (and in CI),
# not in the plain `pnpm test` dev loop - see test.sh Phase 1.5.
step "Phases 1-2: Static Analysis + Unit Tests + Builds"
TEST_STOP_AFTER_BUILD=1 TEST_COVERAGE=1 "$SCRIPT_DIR/test.sh"

# The server coverage run above defers the two dialog-parser timing assertions. V8 coverage makes
# their from-scratch ts-morph arm about 7x slower, then the parallel package suites can starve it
# past Vitest's hang bound where cores are scarce. Run the file again without instrumentation and
# without competing suites: the relative speedup remains a close-out gate, under the cost model it
# is intended to measure. TEST_COVERAGE=0 is explicit in case test-all.sh inherited it from its caller.
step "Dialog source parser reuse performance (serial, no coverage)"
TEST_COVERAGE=0 pnpm exec vitest run --config server/vitest.config.mts \
    server/test/dialog-source-project-reuse.test.ts --maxWorkers=4

# test.sh resolves this before its own Phase 1, but that export dies with the subprocess above, and the
# suites below need it too - so resolve it again here. Cached, so the second call costs nothing.
WEIDU_BIN="$("$SCRIPT_DIR/ensure-weidu.sh")"
export WEIDU_BIN

# All remaining tests in one parallel block.
# Each job only needs CLIs built (done above). Grammar tests build format CLI if missing.
# Keep in sync with test.sh Phase 3 block: what this adds is DEPTH, not new categories -
# the external-corpus format sweep, transpile-external, and the full SSL corpus sweeps
# where test.sh runs only their canary. Grammars and server integration are identical in both.
#
# Every job here READS external/ and none writes it, which is what lets them run together. The format
# sweep used to save its formatted output and delete the excluded files, so everything reading the same
# corpus had to be chained behind it - a correctness constraint that set this phase's shape. It now runs
# --check-idempotency with --exclude-from and touches nothing, so what remains is a scheduling decision:
# a job added here that writes external/ breaks every other job in it.
#
# The three corpus suites stay chained to each other for CPU, not correctness. Each already fans out
# across every core it can get (the format sweep at one worker per core, the other two across their
# files), so running them together buys no wall time and starves them past their own timeouts - which
# guard against hangs, not slowness. Measured: all-parallel left the phase no faster and timed out
# weidu-tp2-file-references and completion-gating-corpus, where chained they cost about what they cost
# alone. A CI runner has fewer cores than a dev machine, where oversubscribing costs more still.
# Order puts the integration suite last, so the shortest-fused of the three runs once the light jobs
# beside it have finished and the box is quiet.
#
# Splitting only PART of the chain does not escape that either: measured, the three legs together want
# well over the cores available, so running the SSL leg beside the other two stretched all three for a
# negligible net gain and still timed out SSL's corpus beforeAll hooks. They are work-bound, not
# schedule-bound - there is no split of them that simply having more cores would not serve better.
#
# test:cli:external is the same suite as test:cli with the external-corpus cases enabled, so this tier
# runs it INSTEAD of test:cli rather than as a second job - running both compiled the shared cases twice.
step "Phase 3 + Extended: All remaining tests"
parallel \
    "Smoke test" "(cd server && pnpm exec vitest run --config vitest.smoke.config.mts)" \
    "Sample + CLI tests" "./server/test/td/test.sh && ./server/test/tbaf/test.sh && pnpm test:cli:external" \
    "Corpus chain (format + binary, SSL, server integration)" "$SCRIPT_DIR/test-external.sh && pnpm exec vitest run --config compilers/ssl/vitest.integration.config.ts && (cd server && pnpm exec vitest run --config vitest.integration.config.mts)" \
    "Grammar tests" "SKIP_FORMAT_BUILD=1 pnpm test:grammars"

# transpile-external is the one suite that WRITES to external/: it transpiles in place and verifies the
# result by `git diff` against the committed output, restoring the generated .ssl afterwards. That
# method needs a clean tree and no concurrent reader, so it runs alone after the block rather than in it.
step "Transpile external (writes external/, so it runs alone)"
pnpm test:transpile-external

timing_summary "All tests passed (full suite)"
