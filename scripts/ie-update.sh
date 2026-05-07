#!/bin/bash

set -xeu -o pipefail

# launch from root repo dir

data_dir="server/data"
data_baf="$data_dir/weidu-baf-iesdp.yml"

external="external/infinity-engine"
mkdir -p "$external"
iesdp_repo="https://github.com/BGforgeNet/iesdp.git"
iesdp_dir="$external/iesdp"

# IESDP (BAF actions/triggers)
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

pnpm exec tsx scripts/ie-update/src/iesdp-update.ts -s "$iesdp_dir" \
    --data-baf "$data_baf"

# regenerate highlight and convert yaml to json
./scripts/generate-data.sh
./scripts/syntaxes-to-json.sh
