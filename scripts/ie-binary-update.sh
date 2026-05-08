#!/bin/bash

# Regenerate binary/src/<format>/specs/*.ts from IESDP _data/file_formats/.
# Mirrors scripts/ie-update.sh - clones IESDP on the ielib branch into
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
# Works whether the local repo came from `git clone` (full history, branches
# tracked) or from clone_repos' `git init + git fetch <SHA>` (shallow, detached
# HEAD, no local branches). Both cases land on the latest remote ielib.
git fetch --depth 1 origin ielib
git checkout -B ielib FETCH_HEAD
popd

pnpm exec tsx scripts/ie-binary-update/src/main.ts -s "$iesdp_dir"
