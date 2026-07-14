#!/bin/bash

# Regenerate expected .ssl output files from the TSSL golden samples.
# Run after an intentional emitter change to refresh the baselines, then review the diff.

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../../ && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT/transpilers/package.json")"

if [[ ! -f "$CLI" ]]; then
    echo "Missing transpile CLI bundle: $CLI"
    exit 1
fi

mkdir -p samples-expected
updated=0

for sample in samples/*.tssl; do
    name=$(basename "$sample" .tssl)
    # fgtp prints its progress log to stderr; only the generated SSL reaches stdout.
    node --no-warnings "$CLI" "$sample" >"samples-expected/${name}.ssl"
    updated=$((updated + 1))
done

echo "Updated $updated expected files"
