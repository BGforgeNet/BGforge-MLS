#!/bin/bash

# Validate TBAF samples are valid TypeScript syntax (single tsc invocation)

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../ && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

# Create symlinks for all samples
links=()
for sample in samples/*.tbaf; do
    name=$(basename "$sample" .tbaf)
    link="${name}.ts"
    ln -sf "$sample" "$link"
    links+=("$link")
done

# Typecheck all samples. --skipLibCheck keeps the check hermetic: without it, tsc auto-includes every ambient
# @types package it can reach (e.g. a globally-installed @types/d3) and reports errors from THOSE .d.ts files
# needing libs the samples don't (DOM), not from the samples. Matches the sibling td typecheck and tsconfig.json.
if $TSC --noEmit --allowUnusedLabels --skipLibCheck --lib ES2015 tbaf-runtime.d.ts "${links[@]}" 2>&1; then
    echo "TBAF typecheck: ${#links[@]} passed, 0 failed"
else
    exit 1
fi

rm -f "${links[@]}"
