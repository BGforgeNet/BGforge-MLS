#!/bin/bash

# Regenerate binary/src/<format>/specs/*.ts from IESDP _data/file_formats/.
# Mirrors scripts/ie-update.sh - clones IESDP on the ielib branch into
# external/infinity-engine/iesdp if missing, then runs the generator.

set -xeu -o pipefail

# launch from root repo dir

# shellcheck source=scripts/external-repos-lib.sh
source ./scripts/external-repos-lib.sh

iesdp_dir="external/infinity-engine/iesdp"
checkout_iesdp_ielib "$iesdp_dir"

pnpm exec tsx scripts/ie-binary-update/src/main.ts -s "$iesdp_dir"
