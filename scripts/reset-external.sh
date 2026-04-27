#!/bin/bash

# Reset all external repos to their committed state (git checkout .).
# If repos don't exist, clone them first.
# Used before tests that read external files, and for manual cleanup.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/external-repos-lib.sh
source "$SCRIPT_DIR/external-repos-lib.sh"

# Clone missing repos first
if [[ -f "$ROOT_DIR/external/fallout.txt" ]]; then
    echo "Cloning missing external repos..."
    clone_repos "$ROOT_DIR/external/fallout.txt" "$ROOT_DIR/external/fallout"
    clone_repos "$ROOT_DIR/external/infinity-engine.txt" "$ROOT_DIR/external/infinity-engine"
fi

# Reset existing repos to clean state
for dir in "$ROOT_DIR"/external/fallout/*/ "$ROOT_DIR"/external/infinity-engine/*/; do
    if [[ -d "$dir/.git" ]]; then
        git -C "$dir" checkout . 2>/dev/null || true
    fi
done

echo "External repos reset"
