#!/bin/bash

set -xeu -o pipefail

# launch from root repo dir

# shellcheck source=scripts/external-repos-lib.sh
source ./scripts/external-repos-lib.sh

sfall_repo="https://github.com/sfall-team/sfall.git"
# Its own checkout, separate from the SSL corpus one external/fallout.txt pins at a different
# commit: the two pins move for different reasons, and moving the corpus pin forces the
# committed compiler oracles to be regenerated.
sfall_dir="external/sfall-data"
# Pinned so a regeneration of the tracked sfall data is reproducible; bump it deliberately
# to the commit of an sfall release tag.
sfall_commit="63606b96d7bb844f0ef82f1c347affca026453b5" # sfall v4.5
sfall_file="server/data/fallout-ssl-sfall.yml"

checkout_pinned_repo "$sfall_repo" "$sfall_commit" "$sfall_dir"

pnpm exec tsx scripts/fallout-update/src/fallout-update.ts -s "$sfall_dir" --sfall-file "$sfall_file"

# Regenerate highlight and convert yaml to json. update-data runs these once at
# its tail (after ie-update and fallout-update), so it sets MLS_SKIP_REGEN=1 to
# skip the duplicate pass here; a standalone `pnpm fallout-update` still
# regenerates so its data lands in the generated highlight/JSON immediately.
if [ "${MLS_SKIP_REGEN:-}" != "1" ]; then
    ./scripts/generate-data.sh
    ./scripts/syntaxes-to-json.sh
fi
