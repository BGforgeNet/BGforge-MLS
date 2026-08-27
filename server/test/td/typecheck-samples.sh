#!/bin/bash

# Validate TD samples are valid TypeScript syntax.

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../ && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

# Create all symlinks first, under the repo tmp/ rather than beside the samples: the root test
# script runs Knip in parallel with this harness, and a .ts file in the source tree is an unused
# file to Knip. Clean them up on every exit path, not just the success one.
LINKDIR="$ROOT/tmp/typecheck-td.$$"
mkdir -p "$LINKDIR"
cleanup() { rm -rf "$LINKDIR"; }
trap cleanup EXIT

links=()
for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    link="$LINKDIR/${name}.ts"
    ln -sf "$PWD/$sample" "$link"
    links+=("$link")
done

# Typecheck all samples. The runtime declarations come from their single source in transpilers/ - a
# copy beside this script would typecheck the samples against a stale API without anything failing.
TD_RUNTIME="$ROOT/transpilers/td/src/td-runtime.d.ts"

if $TSC --noEmit --target ES2015 --skipLibCheck --allowUnusedLabels --lib ES2015 "$TD_RUNTIME" td-engine-stubs.d.ts "${links[@]}" 2>&1; then
    echo "TD typecheck: ${#links[@]} passed, 0 failed"
else
    exit 1
fi
