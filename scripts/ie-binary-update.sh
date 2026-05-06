#!/bin/bash

# Regenerate binary/src/<format>/specs/*.ts from IESDP _data/file_formats/.
# Mirrors scripts/ie-update.sh — clones IESDP on the ielib branch into
# external/infinity-engine/iesdp if missing, then runs the generator.

set -xeu -o pipefail

# launch from root repo dir

external="external/infinity-engine"
mkdir -p "$external"
iesdp_repo="https://github.com/BGforgeNet/iesdp.git"
iesdp_dir="$external/iesdp"

pushd .
if [ ! -d "$iesdp_dir" ]; then
    git clone "$iesdp_repo" "$iesdp_dir"
fi
cd "$iesdp_dir"
git checkout ielib
git pull
popd

pnpm exec tsx scripts/ie-binary-update/src/main.ts -s "$iesdp_dir"
