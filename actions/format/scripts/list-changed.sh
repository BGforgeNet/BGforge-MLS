#!/bin/bash

# Produce the list of source files to feed into the fgfmt CLI.
#
# fgfmt formats files IN PLACE, so - unlike the binary action's <name>.json
# sidecars - the changed source files ARE the unit of work. The supported set is
# hardcoded here: fgfmt has no runtime --extensions flag, so it is kept in sync
# with @bgforge/format by hand (the canonical list lives in format/src/cli.ts;
# see actions/format/README.md). The shared lc_emit_list (../_shared/lib.sh)
# handles SHA resolution, the diff, the deleted-file guard, the full-scan
# fallback, and the list/count outputs.
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# fgfmt's supported extensions (dot-less), plus exact-filename matches.
# Keep in sync with @bgforge/format's EXTENSIONS (format/src/cli.ts).
exts=(ssl baf d tp2 tph tpa tpp tra msg 2da)
extra_names=(scripts.lst)

ext_alt="$(IFS='|'; echo "${exts[*]}")"
# awk alternation over the exact filenames, dots escaped for the regex.
name_alt="$(IFS='|'; echo "${extra_names[*]}")"
name_alt="${name_alt//./\\.}"

find_names=()
for ext in "${exts[@]}"; do
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}")
done
for name in "${extra_names[@]}"; do
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "$name")
done

filter() {
    awk -v alt="$ext_alt" -v names="$name_alt" '
        $0 ~ "\\.("alt")$"     { print; next }
        $0 ~ "(^|/)("names")$" { print }
    '
}

lc_emit_list filter "${find_names[@]}"
