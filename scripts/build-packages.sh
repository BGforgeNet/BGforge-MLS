#!/bin/bash

# Build every package bundle. Independent of each other, so they run in parallel.
#
# They are independent because client/ and server/ reach their workspace dependencies through tsconfig
# `paths` that point at the sibling's `src/`, which esbuild honours - so no bundle here consumes another's
# out/. The one real ordering constraint is upstream of this script: `build:grammar` must have run, since
# the format CLI's post-build step copies the grammar WASMs into format/out.
#
# Serially this took 36.7s of wall for 45.5s of CPU; the machine was idle for most of it.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/build-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# The E2E test bundle rides with the client build rather than taking a slot of its own: both write under
# client/out, and it costs under a tenth of a second, so pairing them removes the only two jobs here that
# share an output directory.
step "Building package bundles"
parallel \
    "Client bundles" "pnpm build:client && pnpm build:test" \
    "Server bundle" "pnpm build:server" \
    "Transpile lib" "pnpm build:transpile" \
    "Format CLI" "pnpm build:format" \
    "Binary CLI" "pnpm build:binary" \
    "SSL CLI" "pnpm build:ssl" \
    "TSSL CLI" "pnpm build:tssl"

timing_summary "Package bundles built"
