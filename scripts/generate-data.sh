#!/bin/bash

# Regenerate hover and completion JSONs from server/data YAMLs.
# Must run before build:ts-plugin (which bundles fallout-ssl-engine-proc-docs.json via esbuild).

set -eu -o pipefail

data_dir="server/data"
dest_dir="server/out"
generate_data=(pnpm exec tsx scripts/utils/src/generate-data.ts)

"${generate_data[@]}" \
    -i "$data_dir/fallout-ssl-base.yml" -i "$data_dir/fallout-ssl-sfall.yml" \
    --completion "$dest_dir/completion.fallout-ssl.json" \
    --hover "$dest_dir/hover.fallout-ssl.json" \
    --signature "$dest_dir/signature.fallout-ssl.json" \
    --tooltip-lang fallout-ssl-tooltip

# Extract engine procedure names and docs for the TSSL transpiler and TypeScript plugin
pnpm exec tsx scripts/utils/src/extract-engine-proc-docs.ts \
    --yaml $data_dir/fallout-ssl-base.yml \
    --out $dest_dir/fallout-ssl-engine-proc-docs.json \
    --names $dest_dir/fallout-ssl-engine-procedures.json

pnpm exec tsx scripts/utils/src/update-fallout-base-functions-highlight.ts \
    --yaml $data_dir/fallout-ssl-base.yml \
    --highlight syntaxes/fallout-ssl.tmLanguage.yml

pnpm exec tsx scripts/utils/src/update-sfall-highlight.ts \
    --yaml $data_dir/fallout-ssl-sfall.yml \
    --highlight syntaxes/fallout-ssl.tmLanguage.yml

"${generate_data[@]}" \
    -i "$data_dir/fallout-worldmap-txt.yml" \
    --completion "$dest_dir/completion.fallout-worldmap-txt.json" \
    --hover "$dest_dir/hover.fallout-worldmap-txt.json" \
    --tooltip-lang fallout-worldmap-txt

"${generate_data[@]}" \
    -i "$data_dir/weidu-tp2-base.yml" \
    --completion "$dest_dir/completion.weidu-tp2.json" \
    --hover "$dest_dir/hover.weidu-tp2.json" \
    --tooltip-lang weidu-tp2-tooltip

pnpm exec tsx scripts/utils/src/update-tp2-highlight.ts \
    --yaml $data_dir/weidu-tp2-base.yml \
    --highlight syntaxes/weidu-tp2.tmLanguage.yml

"${generate_data[@]}" \
    -i "$data_dir/weidu-baf-base.yml" -i "$data_dir/weidu-baf-iesdp.yml" -i "$data_dir/weidu-baf-ids.yml" \
    --completion "$dest_dir/completion.weidu-baf.json" \
    --hover "$dest_dir/hover.weidu-baf.json" \
    --tooltip-lang weidu-baf-tooltip

pnpm exec tsx scripts/utils/src/update-baf-highlight.ts \
    --yaml $data_dir/weidu-baf-iesdp.yml \
    --highlight syntaxes/weidu-baf.tmLanguage.yml

"${generate_data[@]}" \
    -i "$data_dir/weidu-d-base.yml" \
    --completion "$dest_dir/completion.weidu-d.json" \
    --hover "$dest_dir/hover.weidu-d.json" \
    --tooltip-lang weidu-d-tooltip

pnpm exec tsx scripts/utils/src/update-d-highlight.ts \
    --yaml $data_dir/weidu-d-base.yml \
    --highlight syntaxes/weidu-d.tmLanguage.yml
