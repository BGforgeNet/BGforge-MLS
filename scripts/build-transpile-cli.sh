#!/bin/bash

# Build standalone transpile CLI bundle (TSSL, TBAF, TD).
# --alias: CLI runs as standalone node process, not in VSCode extension host,
# so use native esbuild (Go binary) instead of esbuild-wasm for ~100x faster bundling.
# See esbuild-lib.sh for rationale on the --banner/--define __imu shim.

# shellcheck source=scripts/esbuild-lib.sh
source "$(dirname "$0")/esbuild-lib.sh"

rm -f \
  transpilers/cli/out/transpile.js \
  transpilers/cli/out/transpile.js.map \
  transpilers/cli/out/transpile-cli.js \
  transpilers/cli/out/transpile-cli.js.map

esbuild ./transpilers/cli/src/cli.ts \
  --bundle \
  --outfile=transpilers/cli/out/transpile.js \
  --alias:esbuild-wasm=esbuild \
  --external:esbuild \
  --format=cjs \
  --platform=node \
  --sourcemap \
  --banner:js="$imu_banner" \
  "$imu_define"
