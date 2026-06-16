#!/bin/bash

# Stage the reformatted files, then commit and push via the shared
# finalize_commit_and_push (../_shared/lib.sh).
#
# fgfmt formats IN PLACE, so the files run-cli processed (LIST) are exactly the
# files to stage - there is no sidecar to find by extension. Stage precisely those
# paths and let finalize_commit_and_push drop the ones already formatted.
#
# Inputs (env): COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL,
#               LIST (the processed-file list from the list-changed step).
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# Stage only the files fgfmt just processed; never sweep up unrelated changes.
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ -f "$f" ]] && git add -- "$f"
done < "$LIST"

finalize_commit_and_push
