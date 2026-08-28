#!/bin/bash

# Validate TSSL golden samples are valid TypeScript syntax.

set -e

cd "$(dirname "$0")"
# Four levels up: transpile -> tssl -> test -> server -> repo root (this harness nests one
# level deeper than the sibling td/tbaf harnesses; test/tssl/ holds the TSSL dialog fixtures).
ROOT="$(cd ../../../../ && pwd)"
TSC="$ROOT/node_modules/.bin/tsc"

# Create all symlinks first (.tssl -> .ts so tsc will parse them), under the repo tmp/ rather than
# beside the samples: the root test script runs Knip in parallel with this harness, and a .ts file
# in the source tree is an unused file to Knip. Clean them up on every exit path.
LINKDIR="$ROOT/tmp/typecheck-tssl.$$"
mkdir -p "$LINKDIR"
cleanup() { rm -rf "$LINKDIR"; }
trap cleanup EXIT

links=()
for sample in samples/*.tssl; do
    name=$(basename "$sample" .tssl)
    link="$LINKDIR/${name}.ts"
    ln -sf "$PWD/$sample" "$link"
    links+=("$link")
done

# Typecheck all samples together. Each sample ends in `export {};` so it is a module with an
# isolated scope - samples may reuse top-level names (start) without colliding. --skipLibCheck
# keeps the check hermetic, and --ignoreConfig is required from TS 6.0 (see the sibling td/tbaf
# typecheck for the full rationale of both).
if $TSC --noEmit --ignoreConfig --target ES2015 --skipLibCheck --allowUnusedLabels --lib ES2015 tssl-engine-stubs.d.ts "${links[@]}" 2>&1; then
    echo "TSSL typecheck: ${#links[@]} passed, 0 failed"
else
    exit 1
fi
