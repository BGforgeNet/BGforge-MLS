#!/bin/bash

# Stage the generated output files, then commit and push via the shared
# finalize_commit_and_push (../_shared/lib.sh).
#
# fgtp writes each source's output to a sibling path with a different extension
# (.td -> .d, .tbaf -> .baf). The staged unit is the OUTPUT, so we map each
# processed source in LIST to its output path and stage that - never a blind
# `find *.d`, which would also sweep up hand-written, non-transpiled sources
# sharing those extensions.
#
# Inputs (env): COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL,
#               LIST (the processed-source list from the list-changed step).
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# Map each source to its generated output path (mirrors fgtp's getOutputPath).
while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
        *.td) out="${f%.td}.d" ;;
        *.tbaf) out="${f%.tbaf}.baf" ;;
        *) continue ;;
    esac
    [[ -f "$out" ]] && git add -- "$out"
done <"$LIST"

finalize_commit_and_push
