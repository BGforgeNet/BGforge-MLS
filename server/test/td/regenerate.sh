#!/bin/bash

# Regenerate expected .d output files from .td samples.

set -e

cd "$(dirname "$0")"
ROOT="$(cd ../../../ && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT/transpilers/package.json")"

if [[ ! -f "$CLI" ]]; then
    echo "Missing transpile CLI bundle: $CLI"
    exit 1
fi

for sample in samples/*.td; do
    name=$(basename "$sample" .td)
    echo "Regenerating ${name}.d..."
    node --no-warnings "$CLI" "$sample" > "samples-expected/${name}.d"
done

echo "Done."
