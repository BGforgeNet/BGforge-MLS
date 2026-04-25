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

# --- Phase 1: Static analysis + unit tests + dead code (all independent, run in parallel) ---
step "Phase 1: Static Analysis + Unit Tests + Dead Code"
parallel \
    "Shell lint" "pnpm lint:shell" \
    "Typecheck client" "(cd client && pnpm exec tsc --noEmit)" \
    "Typecheck plugins" "(cd plugins/tssl-plugin && pnpm exec tsc --noEmit) && (cd plugins/td-plugin && pnpm exec tsc --noEmit)" \
    "Typecheck server" "(cd server && pnpm exec tsc --noEmit)" \
    "Typecheck CLI" "pnpm exec tsc --project cli/tsconfig.json" \
    "Oxlint" "pnpm exec oxlint" \
    "Lint scripts" "pnpm lint:scripts" \
    "Format check" "pnpm exec oxfmt --check" \
    "Server unit tests + coverage" "(cd server && pnpm exec vitest run --coverage)" \
    "Client unit tests + coverage" "vitest run --config client/vitest.config.ts --coverage" \
    "Plugin unit tests" "vitest run --config plugins/tssl-plugin/vitest.config.ts && vitest run --config plugins/td-plugin/vitest.config.ts" \
    "Transpile lib unit tests" "vitest run --config transpilers/vitest.config.ts" \
    "Script tests" "pnpm test:scripts" \
    "Knip" "pnpm knip" \
    "Knip prod" "pnpm knip:prod"

# --- Phase 2: Builds (server and CLIs in parallel, independent of each other) ---
step "Phase 2: Building Server + CLIs"
parallel \
    "Server bundle" "$SCRIPT_DIR/build-base-server.sh" \
    "Format CLI" "$SCRIPT_DIR/build-format-cli.sh" \
    "Bin CLI" "$SCRIPT_DIR/build-bin-cli.sh"

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
