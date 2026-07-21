#!/bin/bash

# Dev-loop test suite: static analysis, unit tests (no coverage), builds,
# smoke + sample + CLI tests. The close-out gate (coverage thresholds, external
# corpus, integration, grammars) is test-all.sh, which drives this script with
# TEST_COVERAGE=1 / TEST_STOP_AFTER_BUILD=1.
# Uses parallel execution for independent stages to minimize wall time.
# Each parallel job logs to tmp/test-logs/ - silent on success, full output on failure.
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

# Binary unit tests read external/ fixtures; reset so local drift (e.g. editor
# saves against fixture files) doesn't fail them. Fast when already clean.
step "Resetting External Repos"
"$SCRIPT_DIR/reset-external.sh"

# Build the transpile library bundle before Phase 1 so bundle.test.ts can load
# transpilers/out/index.js. The build is fast (~5s) and must precede the parallel block.
step "Building transpile library bundle"
pnpm build:transpile

# --- Phase 1: Static analysis + dead code (all independent, run in parallel) ---
# Coverage runs are deliberately NOT in this block - see Phase 1.5 for why.
# The webview Playwright harnesses are typechecked now that playwright is a pinned devDep (it resolves in
# CI): the dialog-editor harness under client/src is covered by "Typecheck client"; the binary-editor
# harness needs its own step because binary-editor's package tsconfig is DOM-less and excludes it (the
# harness needs a DOM lib for its in-browser page.evaluate callbacks - see the harness tsconfig). The
# harnesses are RUN in headless Chromium by the separate "Harness" workflow, not here.
step "Phase 1: Static Analysis + Dead Code"
parallel \
    "Shell lint" "pnpm lint:shell" \
    "Workflow lint" "pnpm lint:workflows" \
    "Typecheck client" "(cd client && pnpm exec tsc --noEmit)" \
    "Typecheck svelte" "pnpm typecheck:svelte" \
    "Typecheck plugins" "(cd plugins/tssl-plugin && pnpm exec tsc --noEmit) && (cd plugins/td-plugin && pnpm exec tsc --noEmit)" \
    "Typecheck server" "(cd server && pnpm exec tsc --noEmit)" \
    "Typecheck binary" "(cd binary && pnpm exec tsc --noEmit)" \
    "Typecheck binary-editor" "(cd binary-editor && pnpm exec tsc --noEmit)" \
    "Typecheck binary-editor harness" "pnpm exec tsc --project binary-editor/test/harness/tsconfig.json" \
    "Typecheck format" "(cd format && pnpm exec tsc --noEmit)" \
    "Typecheck transpilers" "(cd transpilers && pnpm exec tsc --noEmit)" \
    "Oxlint" "pnpm exec oxlint" \
    "Lint scripts" "pnpm lint:scripts" \
    "Lint md-links" "pnpm lint:md-links" \
    "Format check" "pnpm exec oxfmt --check" \
    "Script tests" "pnpm test:scripts" \
    "Knip" "pnpm knip" \
    "Knip prod" "pnpm knip:prod"

# --- Phase 1.5: Unit tests ---
# Coverage instrumentation roughly triples the unit-test wall time (server:
# 22s plain vs 62s instrumented), so the default run skips it for fast dev
# feedback. TEST_COVERAGE=1 (set by test-all.sh) enables it, which is where
# the coverage thresholds are enforced - the close-out/CI gate.
if [[ "${TEST_COVERAGE:-}" == "1" ]]; then
    # Coverage runs are sequential: Vitest's V8 coverage provider has a known
    # race writing shard files to `<reportsDirectory>/.tmp/coverage-N.json`
    # when many `vitest --coverage` processes run simultaneously: a slow
    # worker can land its writeFile after the main process has already
    # cleaned `.tmp/`, surfacing as ENOENT (vitest-dev/vitest #4943, #5903;
    # not fixed as of vitest 4.1.5). Each config also sets
    # `coverage.clean: false` to skip the outer reportsDirectory wipe. The
    # combination is the maintainer-recommended workaround.
    step "Phase 1.5: Unit tests + coverage (sequential)"
    (cd server && pnpm exec vitest run --coverage)
    vitest run --config client/vitest.config.ts --coverage
    vitest run --config plugins/tssl-plugin/vitest.config.ts --coverage
    vitest run --config plugins/td-plugin/vitest.config.ts --coverage
    vitest run --config transpilers/vitest.config.ts --coverage
    vitest run --config format/vitest.config.ts --coverage
    vitest run --config binary/vitest.config.ts --coverage
    vitest run --config binary-editor/vitest.config.ts --coverage
    vitest run --config shared/vitest.config.ts --coverage
else
    # Without coverage the .tmp shard race above does not apply, so the runs
    # parallelize; each is capped with --maxWorkers because nine uncapped
    # vitest worker pools oversubscribe the CPU badly enough to time out the
    # client worker-integration tests (spawned child workers starve). Caps are
    # sized to each suite's measured weight (binary and server are the heavy
    # ones); the small suites finish early and free their slots.
    step "Phase 1.5: Unit tests (parallel, no coverage)"
    parallel \
        "Unit server" "(cd server && pnpm exec vitest run --maxWorkers=3)" \
        "Unit client" "pnpm exec vitest run --config client/vitest.config.ts --maxWorkers=2" \
        "Unit tssl-plugin" "pnpm exec vitest run --config plugins/tssl-plugin/vitest.config.ts --maxWorkers=1" \
        "Unit td-plugin" "pnpm exec vitest run --config plugins/td-plugin/vitest.config.ts --maxWorkers=1" \
        "Unit transpilers" "pnpm exec vitest run --config transpilers/vitest.config.ts --maxWorkers=2" \
        "Unit format" "pnpm exec vitest run --config format/vitest.config.ts --maxWorkers=1" \
        "Unit binary" "pnpm exec vitest run --config binary/vitest.config.ts --maxWorkers=3" \
        "Unit binary-editor" "pnpm exec vitest run --config binary-editor/vitest.config.ts --maxWorkers=2" \
        "Unit shared" "pnpm exec vitest run --config shared/vitest.config.ts --maxWorkers=1"
fi

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

# --- Phase 3: Tests that need builds (all in parallel) ---
# The external-corpus + integration chain lives in test-all.sh only: it is the
# multi-minute tail of the suite and belongs to the close-out gate, not the
# dev loop. bin-cli tests that read external/ are gated behind
# RUN_EXTERNAL_CLI_TESTS and skip cleanly here.
step "Phase 3: Smoke + Samples + CLI"
parallel \
    "Smoke test" "(cd server && pnpm exec vitest run --config vitest.smoke.config.ts)" \
    "Sample + CLI tests" "./server/test/td/test.sh && ./server/test/tbaf/test.sh && pnpm test:cli"

timing_summary "All tests passed"
