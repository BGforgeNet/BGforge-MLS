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

# Remove excluded files from a directory
remove_excluded() {
    local exclude_file="$1"
    local target_dir="$2"

    [[ ! -f "$exclude_file" ]] && return
    while IFS= read -r file; do
        [[ -z "$file" || "$file" == \#* ]] && continue
        # Skip dangerous paths: absolute or parent refs
        [[ "$file" =~ ^/ || "$file" =~ \.\. ]] && continue
        rm -rf "${target_dir:?}/$file"
    done < "$exclude_file"
}

reset_repos() {
    "$SCRIPT_DIR/reset-external.sh"
}

# Always reset repos on exit (success or failure)
trap reset_repos EXIT

# Test formatter on a directory (format + idempotency check in one pass)
test_format() {
    local target_dir="$1"
    local name="$2"

    if ! find "$target_dir" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | grep -q .; then
        echo "No $name repos to test"
        return
    fi

    step "Formatting $name files (with idempotency check)"
    node "$ROOT_DIR/format/out/cli.js" "$target_dir" -r --save-and-check -q
}

# Test bin CLI on Fallout PRO files (parse only, no snapshot comparison)
test_bin() {
    local target_dir="$1"

    if [[ ! -d "$target_dir" ]]; then
        return
    fi

    step "Testing Fallout binary assets"
    # Stdout mode outputs JSON - discard it, we only care about exit code (parse success)
    node "$ROOT_DIR/binary/out/cli.js" "$target_dir" -r -q > /dev/null
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

# EXTERNAL_REPOS_CLEAN is set by test.sh and test-all.sh when they have already reset
# repos before invoking this script; skip the redundant reset in that case.
if [[ "${EXTERNAL_REPOS_CLEAN:-}" != "1" ]]; then
    step "Resetting repos (pre-test)"
    reset_repos
fi

step "Removing excluded files"
remove_excluded "$ROOT_DIR/external/fallout-exclude.txt" "$ROOT_DIR/external/fallout"
remove_excluded "$ROOT_DIR/external/infinity-engine-exclude.txt" "$ROOT_DIR/external/infinity-engine"

step "Format + Idempotency Tests"
parallel \
    "Fallout" "test_format '$ROOT_DIR/external/fallout' 'Fallout' && test_bin '$ROOT_DIR/external/fallout/Fallout2_Restoration_Project/data'" \
    "Infinity Engine" "test_format '$ROOT_DIR/external/infinity-engine' 'Infinity Engine'"

timing_summary "External tests passed"
