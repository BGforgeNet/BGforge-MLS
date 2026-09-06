#!/usr/bin/env bash

# Run E2E tests using @vscode/test-electron.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail_e2e() {
    echo "E2E test setup failed: $*" >&2
    exit 1
}

on_e2e_error() {
    local exit_code="$1"
    local line_no="$2"
    local command="$3"
    echo "E2E tests failed with exit code $exit_code at line $line_no." >&2
    echo "Last command: $command" >&2
    echo "Check the messages above for the failing prerequisite or test command." >&2
    exit "$exit_code"
}

trap 'on_e2e_error $? $LINENO "$BASH_COMMAND"' ERR

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

for path in "$ROOT_DIR/client/out/test/runTest.js" "$ROOT_DIR/client/out/test/index.js" "$ROOT_DIR/client/out/extension.js"; do
    if [[ ! -f "$path" ]]; then
        fail_e2e "missing built artifact '$path'. Run 'pnpm build' before 'pnpm test:e2e'."
    fi
done

if ! command -v node >/dev/null 2>&1; then
    fail_e2e "required command 'node' is not available."
fi

step "Running E2E tests"

CODE_TESTS_PATH="$ROOT_DIR/client/out/test"
export CODE_TESTS_PATH
CODE_TESTS_WORKSPACE="$ROOT_DIR/client/testFixture"
export CODE_TESTS_WORKSPACE

if ! command -v xvfb-run >/dev/null 2>&1; then
    fail_e2e "required command 'xvfb-run' is not available. Install xvfb before 'pnpm test:e2e'."
fi

xvfb-run -a node "$ROOT_DIR/client/out/test/runTest.js"

timing_summary "E2E tests passed"
