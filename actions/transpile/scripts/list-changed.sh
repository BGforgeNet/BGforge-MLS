#!/bin/bash

# Produce the list of SOURCE files to feed into the fgtp transpiler CLI.
#
# fgtp maps each source to a different-extension output in the same directory
# (.td -> .d, .tbaf -> .baf). The unit of work is the SOURCE file.
# As with the binary action's <name>.json -> binary mapping, a changed OUTPUT
# file maps back to its source so a hand-edited generated file is regenerated
# (reverting the manual edit, or failing the job in check mode). The extension
# set is hardcoded: fgtp has no runtime --extensions flag, so it is kept in sync
# with @bgforge/transpile by hand (transpilers/src/cli.ts; see
# actions/transpile/README.md). The shared lc_emit_list (../_shared/lib.sh)
# handles SHA resolution, the diff, the deleted-source guard, the full-scan
# fallback, and the list/count outputs.
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# fgtp source extensions (dot-less). Each maps to an output by inserting 't'
# after the leading dot: .td<-.d, .tbaf<-.baf (see the filter below). Keep in
# sync with @bgforge/transpile (transpilers/src/cli.ts). TSSL is a compiler
# rather than a transpiler and has its own action (actions/tssl).
in_exts=(td tbaf)
in_alt="$(
    IFS='|'
    echo "${in_exts[*]}"
)"

find_names=()
for ext in "${in_exts[@]}"; do
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}")
done

# A changed source prints as-is; a changed output maps back to its source. The
# anchored output patterns (\.d$ etc) never match a source path (foo.td ends in
# "td", not ".d"), so the cases are mutually exclusive.
filter() {
    awk -v alt="$in_alt" '
        $0 ~ "\\.("alt")$" { print; next }
        /\.baf$/ { sub(/\.baf$/, ".tbaf"); print; next }
        /\.d$/   { sub(/\.d$/,   ".td");   print; next }
    '
}

lc_emit_list filter "${find_names[@]}"
