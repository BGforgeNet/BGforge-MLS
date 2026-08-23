#!/bin/bash

# Compile every .tssl under SCAN_PATH in ONE recursive invocation.
#
# Recursion is the default because TSSL has imports: compiling only the files an event
# touched would skip the dependents of a changed module, which a changed-file list cannot
# see. The compiler's own exit status is the CI gate - bytecode is a build artifact here,
# never committed, so "it compiled" is the whole check.
#
# Inputs (env): SCAN_PATH, EXTRA_ARGS (the validated switches from switches.sh).
set -euo pipefail

read -ra extra <<<"${EXTRA_ARGS:-}"
echo "Compiling ${SCAN_PATH} recursively with: ${extra[*]:-(no extra switches)}"
tssl "$SCAN_PATH" -r "${extra[@]}"
