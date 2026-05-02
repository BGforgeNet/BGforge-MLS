#!/bin/bash
# Produce the list of binary files (.pro / .map) to feed into the binary CLI.
#
# Strategy:
#   - For pull_request and push events with a usable base SHA, list files
#     changed in the event's diff range. Both .pro/.map paths and
#     .pro.json/.map.json paths count: the latter map back to their binary
#     so snapshot-only edits are still reprocessed.
#   - Drop entries whose binary file no longer exists (deleted-binary case).
#   - Fall back to a full recursive scan of SCAN_PATH when no usable base SHA
#     is available (new-branch push, workflow_dispatch, scheduled, etc.).
#
# Inputs (env):  EVENT_NAME, SCAN_PATH,
#                BASE_SHA_PR, HEAD_SHA_PR, BASE_SHA_PUSH, HEAD_SHA_PUSH
# Outputs (env): GITHUB_OUTPUT receives `list=<path>` and `count=<n>`
set -euo pipefail

list="$(mktemp)"
mode=full
base=""
head=""

case "$EVENT_NAME" in
    pull_request)
        base="$BASE_SHA_PR"
        head="$HEAD_SHA_PR"
        ;;
    push)
        base="$BASE_SHA_PUSH"
        head="$HEAD_SHA_PUSH"
        # Zero-SHA = new branch; no usable base for diff.
        [[ "$base" =~ ^0+$ ]] && base=""
        ;;
esac

if [[ -n "$base" && -n "$head" ]]; then
    # Default checkouts are shallow; pull base+head into the local clone so
    # `git diff` can resolve them. Failures here just fall through to full-scan.
    git fetch --no-tags --depth=1 origin "$base" "$head" >/dev/null 2>&1 || true
    if git rev-parse --verify --quiet "$base" >/dev/null \
       && git rev-parse --verify --quiet "$head" >/dev/null; then
        git diff --name-only --diff-filter=AMR "$base" "$head" -- "$SCAN_PATH" \
            | awk '
                /\.(pro|map)$/        { print; next }
                /\.(pro|map)\.json$/  { sub(/\.json$/, ""); print }
              ' \
            | while IFS= read -r f; do [[ -f "$f" ]] && echo "$f"; done \
            > "$list"
        mode=incremental
    fi
fi

if [[ "$mode" == "full" ]]; then
    find "$SCAN_PATH" -type f \( -name '*.pro' -o -name '*.map' \) > "$list"
fi

sort -u -o "$list" "$list"
count=$(wc -l < "$list")
echo "Mode: $mode, files: $count"

{
    echo "list=$list"
    echo "count=$count"
} >> "$GITHUB_OUTPUT"
