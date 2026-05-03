#!/bin/bash

# Generate Fallout pid -> subType table from extracted .pro files.
# Usage: build-pidtypes.sh <proto-dir> <output.json>
#   <proto-dir> must contain items/ and/or scenery/ subdirs of .pro files
#   (matches the layout inside an extracted Fallout master.dat).
#
# Requires: pnpm + jq, and `pnpm build` to have been run so fgbin is on the path.

set -euo pipefail

if [[ $# -ne 2 ]]; then
    echo "Usage: $0 <proto-dir> <output.json>" >&2
    exit 1
fi

proto_dir=$1
output=$2

# Snapshot .pro files. fgbin --save is idempotent (writes only when changed),
# so re-running the script is cheap.
[[ -d $proto_dir/items   ]] && pnpm exec fgbin "$proto_dir/items"   -r --save -q
[[ -d $proto_dir/scenery ]] && pnpm exec fgbin "$proto_dir/scenery" -r --save -q

# Roll snapshots up into a pid -> subType map keyed by the full pid as a
# decimal string. pid = (objectType << 24) | objectId; jq lacks bit-shifts,
# hence the multiply.
roll_up() {
    local dir=$1 section=$2
    [[ -d $dir ]] || { echo '{}'; return; }
    local files=()
    while IFS= read -r -d '' f; do files+=("$f"); done \
        < <(find "$dir" -name '*.pro.json' -print0)
    [[ ${#files[@]} -gt 0 ]] || { echo '{}'; return; }
    jq -s --arg section "$section" '
        map({
            key: (.document.header.objectType * 16777216
                  + .document.header.objectId | tostring),
            value:  .document.sections[$section].subType
        }) | from_entries
    ' "${files[@]}"
}

items=$(roll_up   "$proto_dir/items"   itemProperties)
scenery=$(roll_up "$proto_dir/scenery" sceneryProperties)

jq -n --argjson items "$items" --argjson scenery "$scenery" \
    '{items: $items, scenery: $scenery}' > "$output"

n_items=$(jq '.items   | length' < "$output")
n_scen=$(jq  '.scenery | length' < "$output")
echo "Wrote $output ($n_items items, $n_scen scenery)"
