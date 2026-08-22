#!/bin/bash

# Translate this action's compiler inputs into the tssl CLI's own switches, for
# run-cli.sh to pass through as EXTRA_ARGS.
#
# Emitted as one space-separated string because that is what a composite action
# can carry between steps; every token here is a fixed flag or a single digit
# validated below, so the word-splitting run-cli.sh does on it cannot surprise.
#
# Inputs (env): TRANSPILE, OPT, SHORT_CIRCUIT, GITHUB_OUTPUT.
set -euo pipefail

args=()
[[ "$TRANSPILE" == "true" ]] && args+=(--transpile)
[[ "$SHORT_CIRCUIT" == "true" ]] && args+=(-s)

if [[ -n "$OPT" ]]; then
    # Refused here rather than passed on: the CLI would reject it too, but this
    # names the input that carries the bad value.
    if [[ ! "$OPT" =~ ^[012]$ ]]; then
        echo "Error: the 'opt' input takes 0, 1 or 2, got: $OPT" >&2
        exit 1
    fi
    args+=(--opt "$OPT")
fi

echo "args=${args[*]}" >>"$GITHUB_OUTPUT"
echo "Compiler switches: ${args[*]:-(none)}"
