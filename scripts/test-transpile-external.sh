#!/bin/bash

# E2E transpiler test: transpile .td/.tbaf/.tssl from external repos,
# write output, verify git status is clean (no changes to committed .d/.baf/.ssl).
# Uses directory mode (-r --save) for batch processing in a single node process.
# Repos are tested in parallel since they are independent.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT_DIR/transpilers/cli/package.json")"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/transpile-external-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# Build CLI if missing
if [[ ! -f "$CLI" ]]; then
    step "Building transpile CLI"
    (cd "$ROOT_DIR" && pnpm build:transpile-cli)
fi

# Transpile all files in a repo, then check git status for changes.
# Exits non-zero on failure so parallel runner can detect it.
# $1: repo directory
test_repo() {
    local dir="$1"
    local repo
    repo=$(basename "$dir")

    if [[ ! -d "$dir" ]]; then
        echo "SKIP: $repo (not cloned)"
        return 0
    fi

    # Reset to committed state before testing
    git -C "$dir" checkout .

    # Install dependencies if node_modules is missing.
    # --ignore-workspace prevents pnpm from resolving to the parent monorepo workspace.
    if [[ -f "$dir/package.json" && ! -d "$dir/node_modules" ]]; then
        echo "Installing dependencies for $repo..."
        (cd "$dir" && pnpm install --ignore-workspace)
    fi

    # Transpile all files in one process using directory mode
    if ! node --no-warnings "$CLI" "$dir" -r --save 2>&1; then
        echo "FAIL: $repo (transpilation errors)"
        return 1
    fi

    # Check git status — any modified files mean transpiler output changed
    local changed
    changed=$(git -C "$dir" diff --name-only)
    if [[ -n "$changed" ]]; then
        echo "FAIL: $repo (output differs from committed files)"
        git -C "$dir" diff --stat
        return 1
    fi

    echo "PASS: $repo"
}

step "Transpile external repos"
parallel \
    "bg2-tweaks-and-tricks" "test_repo '$ROOT_DIR/external/infinity-engine/bg2-tweaks-and-tricks'" \
    "bg2-wildmage"          "test_repo '$ROOT_DIR/external/infinity-engine/bg2-wildmage'" \
    "FO2tweaks"             "test_repo '$ROOT_DIR/external/fallout/FO2tweaks'"

timing_summary "Transpile external tests passed"
