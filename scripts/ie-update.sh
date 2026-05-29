#!/bin/bash

set -xeu -o pipefail

# launch from root repo dir

data_dir="server/data"
data_baf="$data_dir/weidu-baf-iesdp.yml"

# shellcheck source=scripts/external-repos-lib.sh
source ./scripts/external-repos-lib.sh

# IESDP (BAF actions/triggers)
iesdp_dir="external/infinity-engine/iesdp"
checkout_iesdp_ielib "$iesdp_dir"

pnpm exec tsx scripts/ie-update/src/iesdp-update.ts -s "$iesdp_dir" \
    --data-baf "$data_baf"

# Regenerate highlight and convert yaml to json. update-data runs these once at
# its tail (after fallout-update too), so it sets IE_UPDATE_SKIP_REGEN=1 to skip
# the duplicate pass here; a standalone `pnpm ie-update` still regenerates so its
# data lands in the generated highlight/JSON immediately.
if [ "${IE_UPDATE_SKIP_REGEN:-}" != "1" ]; then
    ./scripts/generate-data.sh
    ./scripts/syntaxes-to-json.sh
fi
