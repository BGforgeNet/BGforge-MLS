#!/bin/bash

# Write the .ssl each external Fallout mod generates from its .tssl, beside the source, as the mod's own
# build does. The mods ignore those files as build output, so a checkout has none, and the SSL corpus
# sweeps compile them. Needs the tssl CLI built (pnpm build:tssl); scripts/test.sh runs this after it.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TSSL_CLI="$ROOT_DIR/compilers/tssl/out/cli.js"

# shellcheck source=scripts/external-repos-lib.sh
source "$SCRIPT_DIR/external-repos-lib.sh"

if [[ ! -f "$TSSL_CLI" ]]; then
    echo "generate-external-ssl.sh: $TSSL_CLI is missing - run: pnpm build:tssl" >&2
    exit 1
fi

for dir in "$ROOT_DIR"/external/fallout/*/; do
    [[ -d "$dir/.git" ]] || continue
    generate_tssl_ssl "$dir" "$TSSL_CLI"
done
