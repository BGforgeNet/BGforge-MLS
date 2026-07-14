#!/bin/bash

# Validate TSSL golden samples are valid TypeScript syntax.

set -e

cd "$(dirname "$0")"
# Four levels up: transpile -> tssl -> test -> server -> repo root (this harness nests one
# level deeper than the sibling td/tbaf harnesses; test/tssl/ holds the TSSL dialog fixtures).
ROOT="$(cd ../../../../ && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

# Create all symlinks first (.tssl -> .ts so tsc will parse them). Clean them up on every exit
# path so a failed typecheck never leaves stray .ts symlinks in the source tree.
links=()
cleanup() { rm -f "${links[@]}"; }
trap cleanup EXIT

for sample in samples/*.tssl; do
    name=$(basename "$sample" .tssl)
    link="${name}.ts"
    ln -sf "$sample" "$link"
    links+=("$link")
done

# Typecheck all samples together. Each sample ends in `export {};` so it is a module with an
# isolated scope - samples may reuse top-level names (start) without colliding. --skipLibCheck
# keeps the check hermetic (see the sibling td/tbaf typecheck for the full rationale).
if $TSC --noEmit --target ES2015 --skipLibCheck --allowUnusedLabels --lib ES2015 tssl-engine-stubs.d.ts "${links[@]}" 2>&1; then
    echo "TSSL typecheck: ${#links[@]} passed, 0 failed"
else
    exit 1
fi
