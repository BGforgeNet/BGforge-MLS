#!/bin/bash

# Translate this action's compiler inputs into the tssl CLI's own switches, for
# run.sh to pass through as EXTRA_ARGS.
#
# Emitted as one space-separated string because that is what a composite action
# can carry between steps; every token here is a fixed flag or a single digit
# validated below, so the word-splitting run.sh does on it cannot surprise.
#
# Inputs (env): SSL, INT, OPT, SHORT_CIRCUIT, GITHUB_OUTPUT.
set -euo pipefail

# Both opt and short-circuit steer the bytecode emitter, which int: "false" never reaches - the CLI
# would take them and warn. Dropped before they are built, and said out loud rather than silently, so
# a caller setting the level globally can see which inputs this run ignored.
if [[ "$INT" == "false" ]] && { [[ -n "$OPT" ]] || [[ "$SHORT_CIRCUIT" == "true" ]]; }; then
    echo "int is off, so no bytecode is compiled: ignoring the opt and short-circuit inputs."
    OPT=""
    SHORT_CIRCUIT="false"
fi

args=()
[[ "$SSL" == "true" ]] && args+=(--ssl)
[[ "$INT" == "false" ]] && args+=(--no-int)
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
