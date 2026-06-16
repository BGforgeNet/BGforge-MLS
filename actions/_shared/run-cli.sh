#!/bin/bash

# Run the action's CLI on each path in LIST. CHECK_MODE="true" picks --check
# (verify-only, exit non-zero on the first offending file); anything else picks
# --save (write the result). Shared by all actions/* composite actions.
# Inputs (env): CLI (fgbin|fgfmt|fgtp), LIST, COUNT, CHECK_MODE
set -euo pipefail

if [[ "$COUNT" == "0" ]]; then
    echo "No files to process."
    exit 0
fi

flag="--save"
if [[ "$CHECK_MODE" == "true" ]]; then
    flag="--check"
fi

while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    "$CLI" "$f" "$flag"
done < "$LIST"
