#!/bin/bash

# Test external repos: clone, parse, format, check idempotency.
# Tests both Fallout (SSL, PRO) and Infinity Engine (BAF, D, TP2) repos.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/external-test-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# shellcheck source=scripts/external-repos-lib.sh
source "$SCRIPT_DIR/external-repos-lib.sh"

# This script does not write to external/: the formatter runs in --check-idempotency mode, which
# reaches the same verdict without saving, and the exclusion lists are passed to the CLIs instead of
# being applied by deleting the files. That is what lets test-all.sh run this beside the other suites
# that read the same corpus, rather than chaining them behind it - so keep every step here read-only.
#
# It therefore does not reset the trees either, and expects a caller that has: test.sh resets once at
# the top of the gate, and the `pnpm test:external` script chains reset-external.sh ahead of this.

# Test formatter on a directory (format + idempotency check in one pass)
test_format() {
    local target_dir="$1"
    local name="$2"
    local exclude_file="$3"

    if ! find "$target_dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -q .; then
        echo "No $name repos to test"
        return
    fi

    step "Formatting $name files (with idempotency check)"
    # --jobs: the corpus is ~17k files and the per-file work is CPU-bound;
    # the parallel fan-out cuts the pass from minutes to well under one.
    node "$ROOT_DIR/format/out/cli.js" "$target_dir" -r --check-idempotency -q \
        --jobs "$(nproc)" --exclude-from "$exclude_file"
}

# Test bin CLI on Fallout PRO files (parse only, no snapshot comparison)
test_bin() {
    local target_dir="$1"
    local exclude_file="$2"
    local exclude_base="$3"

    if [[ ! -d "$target_dir" ]]; then
        return
    fi

    step "Testing Fallout binary assets"
    # Stdout mode outputs JSON - discard it, we only care about exit code (parse success).
    # --jobs: the map decode is CPU-bound and was the longest single-core stretch of this script.
    # --exclude-base: the list's paths are relative to external/fallout, this target is deeper in.
    node "$ROOT_DIR/binary/out/cli.js" "$target_dir" -r -q --jobs "$(nproc)" \
        --exclude-from "$exclude_file" --exclude-base "$exclude_base" >/dev/null
}

step "Building CLIs"
if [[ ! -f "$ROOT_DIR/format/out/cli.js" ]]; then
    (cd "$ROOT_DIR" && pnpm build:format)
fi
if [[ ! -f "$ROOT_DIR/binary/out/cli.js" ]]; then
    (cd "$ROOT_DIR" && pnpm build:binary)
fi

step "Setting up Fallout repos"
clone_repos "$ROOT_DIR/external/fallout.txt" "$ROOT_DIR/external/fallout"

step "Setting up Infinity Engine repos"
clone_repos "$ROOT_DIR/external/infinity-engine.txt" "$ROOT_DIR/external/infinity-engine"

step "Format + Idempotency Tests"
parallel \
    "Fallout" "test_format '$ROOT_DIR/external/fallout' 'Fallout' '$ROOT_DIR/external/fallout-exclude.txt' && test_bin '$ROOT_DIR/external/fallout/Fallout2_Restoration_Project/data' '$ROOT_DIR/external/fallout-exclude.txt' '$ROOT_DIR/external/fallout'" \
    "Infinity Engine" "test_format '$ROOT_DIR/external/infinity-engine' 'Infinity Engine' '$ROOT_DIR/external/infinity-engine-exclude.txt'"

timing_summary "External tests passed"
