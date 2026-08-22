#!/bin/bash

# Stage the compiled output files, then commit and push via the shared
# finalize_commit_and_push (../_shared/lib.sh).
#
# The staged unit is the OUTPUT, so each processed source in LIST is mapped to
# its output paths and those are staged - never a blind `find *.int`, which in a
# Fallout mod would also sweep up the bytecode of every hand-written .ssl.
# The .ssl is staged only when the run was asked to write one: without
# --transpile the compiler never touches it, so staging it anyway would commit
# an unrelated edit the author happened to have in the tree.
#
# Inputs (env): COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL,
#               TRANSPILE, LIST (the processed-source list from list-changed).
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    [[ "$f" == *.tssl ]] || continue
    stem="${f%.tssl}"
    [[ -f "$stem.int" ]] && git add -- "$stem.int"
    if [[ "$TRANSPILE" == "true" && -f "$stem.ssl" ]]; then
        git add -- "$stem.ssl"
    fi
done <"$LIST"

finalize_commit_and_push
