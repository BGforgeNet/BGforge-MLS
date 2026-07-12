#!/bin/bash

# Produce the list of binary files to feed into the fgbin CLI, and thread the
# extension list to the commit step.
#
# The recognized extensions are discovered at runtime from `fgbin --extensions`,
# so any format newly registered in @bgforge/binary's parserRegistry is picked up
# without an action release. A changed binary counts directly; a changed
# <name>.json snapshot maps back to its binary so snapshot-only edits reprocess.
# The shared lc_emit_list (../_shared/lib.sh) handles SHA resolution, the diff,
# the deleted-file guard, the full-scan fallback, and the list/count outputs.
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# Read the extension list from the installed fgbin. Bail loudly if absent;
# a silent miss would resurface the very gap this design closes.
mapfile -t exts < <(fgbin --extensions)
if [[ "${#exts[@]}" -eq 0 ]]; then
    echo "fgbin --extensions returned no extensions; aborting." >&2
    exit 1
fi

ext_alt="$(
    IFS='|'
    echo "${exts[*]}"
)"
find_names=()
for ext in "${exts[@]}"; do
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}")
done

filter() {
    awk -v alt="$ext_alt" '
        $0 ~ "\\.("alt")$"        { print; next }
        $0 ~ "\\.("alt")\\.json$" { sub(/\.json$/, ""); print }
    '
}

# The commit step stages `*.<ext>.json`, so pass the canonical extension list on.
ext_csv="$(
    IFS=','
    echo "${exts[*]}"
)"
echo "extensions=$ext_csv" >>"$GITHUB_OUTPUT"

lc_emit_list filter "${find_names[@]}"
