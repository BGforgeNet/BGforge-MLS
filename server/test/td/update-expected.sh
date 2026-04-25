#!/bin/bash

# Regenerate expected .d output files from TD samples.
# Run after changing the emitter to update test baselines.

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../ && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT/transpilers/cli/package.json")"

if [[ ! -f "$CLI" ]]; then
    echo "Missing transpile CLI bundle: $CLI"
    exit 1
fi

updated=0

for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    expected="samples-expected/${name}.d"

    if [[ ! -f "$expected" ]]; then
        continue
    fi

    node --no-warnings "$CLI" "$sample" > "$expected"
    updated=$((updated + 1))
done

echo "Updated $updated expected files"
