#!/bin/bash
# Run @bgforge/binary's CLI on each path in LIST. CHECK_MODE="true" picks
# --check (verify-only); anything else picks --save (refresh snapshots).
#
# Inputs (env): LIST, COUNT, CHECK_MODE
set -euo pipefail

if [[ "$COUNT" == "0" ]]; then
    echo "No binary files to process."
    exit 0
fi

flag="--save"
if [[ "$CHECK_MODE" == "true" ]]; then
    flag="--check"
fi

while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    fgbin "$f" "$flag"
done < "$LIST"
