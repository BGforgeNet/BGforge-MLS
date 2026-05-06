#!/bin/bash
# Produce the list of binary files to feed into the binary CLI.
#
# The set of recognized extensions is discovered at runtime from
# `fgbin --extensions`, so any format newly registered in @bgforge/binary's
# parserRegistry is picked up here without an action release.
#
# Strategy:
#   - For pull_request and push events with a usable base SHA, list files
#     changed in the event's diff range. Both binary paths and their
#     <name>.json snapshot paths count: the latter map back to their binary
#     so snapshot-only edits are still reprocessed.
#   - Drop entries whose binary file no longer exists (deleted-binary case).
#   - Fall back to a full recursive scan of SCAN_PATH when no usable base SHA
#     is available (new-branch push, workflow_dispatch, scheduled, etc.).
#
# Inputs (env):  EVENT_NAME, SCAN_PATH,
#                BASE_SHA_PR, HEAD_SHA_PR, BASE_SHA_PUSH, HEAD_SHA_PUSH
# Outputs (env): GITHUB_OUTPUT receives `list=<path>`, `count=<n>`,
#                and `extensions=<csv>` (for downstream steps).
set -euo pipefail

# Read the extension list from the installed fgbin. Bail loudly if absent;
# silent miss would resurface the very gap this design closes.
mapfile -t exts < <(fgbin --extensions)
if [[ "${#exts[@]}" -eq 0 ]]; then
    echo "fgbin --extensions returned no extensions; aborting." >&2
    exit 1
fi

# Build the awk alternation (e.g. "pro|map|itm|spl|eff") and the find
# -name clause from the discovered list.
ext_alt="$(IFS='|'; echo "${exts[*]}")"
find_names=()
for ext in "${exts[@]}"; do
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}")
done

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
            | awk -v alt="$ext_alt" '
                $0 ~ "\\.("alt")$"        { print; next }
                $0 ~ "\\.("alt")\\.json$" { sub(/\.json$/, ""); print }
              ' \
            | while IFS= read -r f; do [[ -f "$f" ]] && echo "$f"; done \
            > "$list"
        mode=incremental
    fi
fi

if [[ "$mode" == "full" ]]; then
    find "$SCAN_PATH" -type f \( "${find_names[@]}" \) > "$list"
fi

sort -u -o "$list" "$list"
count=$(wc -l < "$list")
echo "Mode: $mode, files: $count"

ext_csv="$(IFS=','; echo "${exts[*]}")"
{
    echo "list=$list"
    echo "count=$count"
    echo "extensions=$ext_csv"
} >> "$GITHUB_OUTPUT"
