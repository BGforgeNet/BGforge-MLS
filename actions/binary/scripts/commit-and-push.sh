#!/bin/bash

# Stage refreshed JSON snapshots, then commit and push via the shared
# finalize_commit_and_push (../_shared/lib.sh).
#
# fgbin writes a <name>.json sidecar whose path differs from the binary's, so the
# staged unit is found by extension rather than taken from the processed list. The
# `*.<ext>.json` clause is built from the list-changed step's `extensions` output.
#
# Inputs (env): COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL,
#               EXTENSIONS (csv of binary extensions from the list-changed step).
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

if [[ -z "${EXTENSIONS:-}" ]]; then
    echo "EXTENSIONS env var is empty; expected csv from list-changed step." >&2
    exit 1
fi
IFS=',' read -r -a exts <<<"$EXTENSIONS"
find_names=()
for ext in "${exts[@]}"; do
    [[ -z "$ext" ]] && continue
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}.json")
done

# Stage only snapshot files; never sweep up unrelated working-tree changes.
find . -type f \( "${find_names[@]}" \) -print0 |
    xargs -0 -r git add --

finalize_commit_and_push
