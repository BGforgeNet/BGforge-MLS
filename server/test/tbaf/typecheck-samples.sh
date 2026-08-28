#!/bin/bash

# Validate TBAF samples are valid TypeScript syntax (single tsc invocation)

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../ && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

# Create symlinks for all samples, under the repo tmp/ rather than beside the samples: the root test
# script runs Knip in parallel with this harness, and a .ts file in the source tree is an unused file
# to Knip. Clean them up on every exit path, not just the success one.
LINKDIR="$ROOT/tmp/typecheck-tbaf.$$"
mkdir -p "$LINKDIR"
cleanup() { rm -rf "$LINKDIR"; }
trap cleanup EXIT

links=()
for sample in samples/*.tbaf; do
    name=$(basename "$sample" .tbaf)
    link="$LINKDIR/${name}.ts"
    ln -sf "$PWD/$sample" "$link"
    links+=("$link")
done

# Typecheck all samples. --skipLibCheck keeps the check hermetic: without it, tsc auto-includes every ambient
# @types package it can reach (e.g. a globally-installed @types/d3) and reports errors from THOSE .d.ts files
# needing libs the samples don't (DOM), not from the samples. Matches the sibling td typecheck and tsconfig.json.
# --ignoreConfig is required from TS 6.0 (see the sibling td typecheck for the full rationale).
if $TSC --noEmit --ignoreConfig --allowUnusedLabels --skipLibCheck --lib ES2015 tbaf-runtime.d.ts "${links[@]}" 2>&1; then
    echo "TBAF typecheck: ${#links[@]} passed, 0 failed"
else
    exit 1
fi
