#!/bin/bash

# Run all tests across the monorepo.
# Uses parallel execution for independent stages to minimize wall time.
# Each parallel job logs to tmp/test-logs/ — silent on success, full output on failure.
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/test-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

step "Resetting External Repos"
"$SCRIPT_DIR/reset-external.sh"
# Consumed by test-external.sh to skip its own redundant reset when called from this script.
export EXTERNAL_REPOS_CLEAN=1

# Build the transpile library bundle before Phase 1 so bundle.test.ts can load
# transpilers/out/index.js. The build is fast (~5s) and must precede the parallel block.
step "Building transpile library bundle"
pnpm build:transpile

# --- Phase 1: Static analysis + dead code (all independent, run in parallel) ---
# Coverage runs are deliberately NOT in this block — see Phase 1.5 for why.
step "Phase 1: Static Analysis + Dead Code"
parallel \
    "Shell lint" "pnpm lint:shell" \
    "Typecheck client" "(cd client && pnpm exec tsc --noEmit)" \
    "Typecheck plugins" "(cd plugins/tssl-plugin && pnpm exec tsc --noEmit) && (cd plugins/td-plugin && pnpm exec tsc --noEmit)" \
    "Typecheck server" "(cd server && pnpm exec tsc --noEmit)" \
    "Typecheck binary" "(cd binary && pnpm exec tsc --noEmit)" \
    "Typecheck format" "(cd format && pnpm exec tsc --noEmit)" \
    "Typecheck transpilers" "(cd transpilers && pnpm exec tsc --noEmit)" \
    "Oxlint" "pnpm exec oxlint" \
    "Lint scripts" "pnpm lint:scripts" \
    "Format check" "pnpm exec oxfmt --check" \
    "Script tests" "pnpm test:scripts" \
    "Knip" "pnpm knip" \
    "Knip prod" "pnpm knip:prod"

# --- Phase 1.5: Coverage runs (sequential) ---
# Vitest's V8 coverage provider has a known race writing shard files to
# `<reportsDirectory>/.tmp/coverage-N.json` when many `vitest --coverage`
# processes run simultaneously: a slow worker can land its writeFile after
# the main process has already cleaned `.tmp/`, surfacing as ENOENT
# (vitest-dev/vitest #4943, #5903; not fixed as of vitest 4.1.5). Each
# config also sets `coverage.clean: false` to skip the outer reportsDirectory
# wipe. The combination is the maintainer-recommended workaround.
# Wall-time cost: each coverage run was previously sharing CPU with ~12
# other parallel jobs; running them sequentially on an idle CPU finishes
# each one faster, so the net penalty is smaller than the sum.
step "Phase 1.5: Unit tests + coverage (sequential)"
(cd server && pnpm exec vitest run --coverage)
vitest run --config client/vitest.config.ts --coverage
vitest run --config plugins/tssl-plugin/vitest.config.ts --coverage
vitest run --config plugins/td-plugin/vitest.config.ts --coverage
vitest run --config transpilers/vitest.config.ts --coverage
vitest run --config format/vitest.config.ts --coverage
vitest run --config binary/vitest.config.ts --coverage
vitest run --config shared/vitest.config.ts --coverage

# --- Phase 2: Builds (server and CLIs in parallel, independent of each other) ---
step "Phase 2: Building Server + CLIs"
parallel \
    "Server bundle" "$SCRIPT_DIR/build-base-server.sh" \
    "Format CLI" "pnpm --filter @bgforge/format build" \
    "Binary CLI" "pnpm --filter @bgforge/binary build"

# Support early exit for test-all.sh (runs its own Phase 3 with extended tests interleaved)
if [[ "${TEST_STOP_AFTER_BUILD:-}" == "1" ]]; then
    timing_summary "Phases 1-2 passed (build-only mode)"
    exit 0
fi

# --- Phase 3: Tests that need builds + integration (all in parallel) ---
# Keep in sync with test-all.sh Phase 3 block (adds grammar + transpile-external jobs).
# External + Integration are chained: external tests reset repos via EXIT trap,
# then integration tests run on clean repo state.
step "Phase 3: Smoke + Samples + External + Integration"
parallel \
    "Smoke test" "(cd server && pnpm exec vitest run --config vitest.smoke.config.ts)" \
    "Sample + CLI tests" "./server/test/td/test.sh && ./server/test/tbaf/test.sh && pnpm test:cli" \
    "External + Integration" "$SCRIPT_DIR/test-external.sh && (cd server && pnpm exec vitest run --config vitest.integration.config.ts)"

timing_summary "All tests passed"
