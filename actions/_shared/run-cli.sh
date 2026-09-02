#!/bin/bash

# Run the action's CLI on each path in LIST. CHECK_MODE="true" picks --check
# (verify-only, exit non-zero on the first offending file); anything else picks
# --save (write the result). Shared by all actions/* composite actions.
#
# EXTRA_ARGS carries switches only some CLIs take (the tssl compiler's --opt and
# --ssl). It is optional and word-split deliberately: an action builds it
# from its own validated inputs, so it is a list of tokens rather than one
# argument. Callers that pass nothing get the same command line as before.
# Inputs (env): CLI (fgbin|fgfmt|fgtp|tssl), LIST, COUNT, CHECK_MODE, EXTRA_ARGS
set -euo pipefail

if [[ "$COUNT" == "0" ]]; then
    echo "No files to process."
    exit 0
fi

flag="--save"
if [[ "$CHECK_MODE" == "true" ]]; then
    flag="--check"
fi

read -ra extra <<<"${EXTRA_ARGS:-}"

while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    "$CLI" "$f" "$flag" "${extra[@]}"
done <"$LIST"
