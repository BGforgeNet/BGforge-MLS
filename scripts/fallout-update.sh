#!/bin/bash

set -xeu -o pipefail

# launch from root repo dir

external="external/fallout"
sfall_repo="https://github.com/BGforgeNet/sfall.git"
sfall_dir="sfall"
sfall_file="server/data/fallout-ssl-sfall.yml"

if [ ! -d "$external" ]; then
    mkdir "$external"
fi

# sfall
pushd .
cd "$external"
if [ ! -d "$sfall_dir" ]; then
    git clone "$sfall_repo" "$sfall_dir"
fi
cd "$sfall_dir"
git checkout master
git pull
git fetch --tags
last_v="v$(git tag | grep "^v" | sed 's|^v||' | sort -V | tail -1)"
git checkout "$last_v"
popd

pnpm exec tsx scripts/fallout-update/src/fallout-update.ts -s "$external" --sfall-file "$sfall_file"

# Regenerate highlight and convert yaml to json. update-data runs these once at
# its tail (after ie-update and fallout-update), so it sets MLS_SKIP_REGEN=1 to
# skip the duplicate pass here; a standalone `pnpm fallout-update` still
# regenerates so its data lands in the generated highlight/JSON immediately.
if [ "${MLS_SKIP_REGEN:-}" != "1" ]; then
    ./scripts/generate-data.sh
    ./scripts/syntaxes-to-json.sh
fi
