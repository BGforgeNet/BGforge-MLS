#!/bin/bash

# Verify or commit the generated .ssl, after run.sh has compiled.
#
# The .int is never staged: a mod does not commit Fallout bytecode, so compiling it is the
# check and the file stays a build artifact. The .ssl is a committed artifact only for a mod
# that ships generated SSL, which is exactly what `transpile: true` asks for - so it is the
# only thing this step can commit, and with transpile off there is nothing to do.
#
# Outputs are derived from the sources found under SCAN_PATH, never globbed: a hand-written
# .ssl with no .tssl beside it must not be claimed as generated output.
#
# Inputs (env): SCAN_PATH, TRANSPILE, CHECK_MODE, COMMIT_MESSAGE, COMMIT_AUTHOR_NAME,
#               COMMIT_AUTHOR_EMAIL, GITHUB_OUTPUT.
set -euo pipefail
# Sourced at runtime from a path only known then ($GITHUB_ACTION_PATH); lib.sh is
# linted on its own, so tell shellcheck not to try to follow it here.
# shellcheck disable=SC1091
source "${GITHUB_ACTION_PATH}/../_shared/lib.sh"

emit_unchanged() {
    {
        echo "changed=false"
        echo "changed-files="
    } >>"$GITHUB_OUTPUT"
}

if [[ "$TRANSPILE" != "true" ]]; then
    echo "transpile is off: the compile was the check, and there is no generated .ssl to commit."
    emit_unchanged
    exit 0
fi

outputs=()
while IFS= read -r src; do
    ssl="${src%.tssl}.ssl"
    [[ -f "$ssl" ]] && outputs+=("$ssl")
done < <(find "$SCAN_PATH" -type f -name "*.tssl")

if [[ ${#outputs[@]} -eq 0 ]]; then
    echo "No generated .ssl found under ${SCAN_PATH}."
    emit_unchanged
    exit 0
fi

if [[ "$CHECK_MODE" == "true" ]]; then
    # run.sh has just rewritten each .ssl, so anything git still reports as differing is a
    # committed file that had gone stale against its source.
    if ! git diff --exit-code -- "${outputs[@]}"; then
        echo "Error: the committed .ssl is out of date with its .tssl source (diff above)." >&2
        exit 1
    fi
    echo "Generated .ssl is up to date."
    exit 0
fi

git add -- "${outputs[@]}"
finalize_commit_and_push
