#!/bin/bash

# Dev-loop test suite: static analysis, unit tests (no coverage), builds, smoke + sample + CLI tests,
# grammars, server integration, and the SSL corpus canary - every category the gate covers, at dev-loop
# depth, so none can break silently until close-out. The close-out gate (coverage thresholds, the
# external-corpus format sweep, the full SSL corpus sweeps, transpile-external) is test-all.sh, which
# drives this script with TEST_COVERAGE=1 / TEST_STOP_AFTER_BUILD=1.
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

# Four suites drive the real WeiDU as their authority and SKIP without one, so resolve it BEFORE Phase 1
# rather than letting one quietly drop itself. Three (the BCS and DLG differentials, and the DLG parser's
# compiled fixtures) run in the unit phase, so resolving this at Phase 3 - where only the TP2 grammar
# differential needed it - left them skipping on any host without a WeiDU already on PATH. Cached after
# the first run.
WEIDU_BIN="$("$SCRIPT_DIR/ensure-weidu.sh")"
export WEIDU_BIN

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
    "Typecheck image" "(cd image && pnpm exec tsc --noEmit)" \
    "Typecheck transpilers" "(cd transpilers && pnpm exec tsc --noEmit)" \
    "Typecheck bcs" "(cd compilers/bcs && pnpm exec tsc --noEmit)" \
    "Typecheck ssl" "(cd compilers/ssl && pnpm exec tsc --noEmit)" \
    "Typecheck tssl" "(cd compilers/tssl && pnpm exec tsc --noEmit)" \
    "Oxlint" "pnpm exec oxlint" \
    "Type-aware lint" "pnpm lint:types" \
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
    # Vitest's V8 coverage `.tmp/coverage-N.json` shard race (vitest-dev/vitest
    # #4943, #5903) is scoped to a shared reportsDirectory: it reproduced
    # instantly when the two plugin configs both used the default `coverage`
    # dir, and vanished once every config set a distinct one. With distinct
    # dirs plus `coverage.clean: false` these runs parallelize cleanly
    # (verified over repeated runs); worker caps mirror the no-coverage block.
    step "Phase 1.5: Unit tests + coverage (parallel)"
    parallel \
        "Coverage server" "(cd server && pnpm exec vitest run --coverage --maxWorkers=3)" \
        "Coverage client" "pnpm exec vitest run --config client/vitest.config.ts --coverage --maxWorkers=2" \
        "Coverage tssl-plugin" "pnpm exec vitest run --config plugins/tssl-plugin/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage td-plugin" "pnpm exec vitest run --config plugins/td-plugin/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage transpilers" "pnpm exec vitest run --config transpilers/vitest.config.ts --coverage --maxWorkers=2" \
        "Coverage format" "pnpm exec vitest run --config format/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage binary" "pnpm exec vitest run --config binary/vitest.config.ts --coverage --maxWorkers=3" \
        "Coverage binary-editor" "pnpm exec vitest run --config binary-editor/vitest.config.ts --coverage --maxWorkers=2" \
        "Coverage image" "pnpm exec vitest run --config image/vitest.config.ts --coverage --maxWorkers=2" \
        "Coverage bcs" "pnpm exec vitest run --config compilers/bcs/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage ssl" "pnpm exec vitest run --config compilers/ssl/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage tssl" "pnpm exec vitest run --config compilers/tssl/vitest.config.ts --coverage --maxWorkers=1" \
        "Coverage shared" "pnpm exec vitest run --config shared/vitest.config.ts --coverage --maxWorkers=1"
else
    # Without coverage the .tmp shard race above does not apply, so the runs
    # parallelize; each is capped with --maxWorkers because ten uncapped
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
        "Unit image" "pnpm exec vitest run --config image/vitest.config.ts --maxWorkers=2" \
        "Unit bcs" "pnpm exec vitest run --config compilers/bcs/vitest.config.ts --maxWorkers=1" \
        "Unit ssl" "pnpm exec vitest run --config compilers/ssl/vitest.config.ts --maxWorkers=1" \
        "Unit tssl" "pnpm exec vitest run --config compilers/tssl/vitest.config.ts --maxWorkers=1" \
        "Unit shared" "pnpm exec vitest run --config shared/vitest.config.ts --maxWorkers=1"
fi

# --- Phase 2: Builds (server and CLIs in parallel, independent of each other) ---
step "Phase 2: Building Server + CLIs"
parallel \
    "Server bundle" "$SCRIPT_DIR/build-base-server.sh" \
    "Format CLI" "pnpm --filter @bgforge/format build" \
    "Binary CLI" "pnpm --filter @bgforge/binary build" \
    "SSL CLI" "pnpm --filter @bgforge/ssl build" \
    "TSSL CLI" "pnpm --filter @bgforge/tssl build"

# Support early exit for test-all.sh (runs its own Phase 3 with extended tests interleaved)
if [[ "${TEST_STOP_AFTER_BUILD:-}" == "1" ]]; then
    timing_summary "Phases 1-2 passed (build-only mode)"
    exit 0
fi

# --- Phase 3: Tests that need builds (all in parallel) ---
# Every category the close-out gate covers is represented here at dev-loop depth: grammars whole, server
# integration whole, and the SSL corpus as its 24-script canary, which states its own denominator so a
# green here cannot read as a swept corpus. Close-out keeps the full corpus sweeps and
# transpile-external, plus the format/idempotency sweep.
#
# Every job in this block READS external/ and none writes it, which is what lets them run together - the
# format sweep MUTATES those trees (hence the reset trap in test-external.sh) and stays in test-all.sh
# for that reason, and bin-cli tests that read external/ are gated behind RUN_EXTERNAL_CLI_TESTS and skip
# cleanly here. Adding a job that writes there, or setting that variable, breaks both sides at once.
step "Phase 3: Smoke + Samples + CLI + Grammars + Integration + Corpus canary"
parallel \
    "Smoke test" "(cd server && pnpm exec vitest run --config vitest.smoke.config.ts)" \
    "Sample + CLI tests" "./server/test/td/test.sh && ./server/test/tbaf/test.sh && pnpm test:cli" \
    "Grammar tests" "SKIP_FORMAT_BUILD=1 pnpm test:grammars" \
    "Server integration" "(cd server && pnpm exec vitest run --config vitest.integration.config.ts)" \
    "Corpus canary" "pnpm exec vitest run --config compilers/ssl/vitest.integration.config.ts corpus-smoke"

timing_summary "All tests passed"
