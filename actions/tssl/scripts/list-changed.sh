#!/bin/bash

# Produce the list of SOURCE files to feed into the tssl compiler CLI.
#
# tssl writes each source's bytecode to a sibling .int, and with --transpile the
# readable .ssl beside it. The unit of work is the SOURCE file. As with the other
# actions, a changed OUTPUT maps back to its source so a hand-edited generated
# file is regenerated (reverting the manual edit, or failing the job in check
# mode). Both output extensions also name plenty of files that are NOT generated
# - a hand-written .ssl and the .int compiled from it are how most Fallout mods
# are still written - but the mapping only produces a path, and lc_emit_list
# keeps a path only when the file exists, so a .ssl with no .tssl beside it drops
# out rather than being claimed. The shared lc_emit_list (../_shared/lib.sh)
# handles SHA resolution, the diff, the deleted-source guard, the full-scan
# fallback, and the list/count outputs.
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

# A changed source prints as-is; a changed output maps back to its source. The
# anchored output patterns never match a source path (foo.tssl ends in "tssl",
# not ".ssl" - the sub would produce foo.ttssl, which no lookup finds), so the
# .tssl case is tested first and the cases stay mutually exclusive.
filter() {
    awk '
        /\.tssl$/ { print; next }
        /\.int$/  { sub(/\.int$/,  ".tssl"); print; next }
        /\.ssl$/  { sub(/\.ssl$/,  ".tssl"); print; next }
    '
}

lc_emit_list filter -name "*.tssl"
