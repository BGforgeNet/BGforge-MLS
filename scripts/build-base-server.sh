#!/bin/bash

set -eu -o pipefail

# Build server bundle
# --define replaces import.meta.url references with __imu (defined in --banner).
# Shebang is for npm bin entry; harmless when VSCode spawns via node
# (Node treats #! as a comment in CJS modules).
# See esbuild-lib.sh for rationale on the __imu shim.

# shellcheck source=scripts/esbuild-lib.sh
source "$(dirname "$0")/esbuild-lib.sh"

esbuild ./server/src/server.ts --bundle --outfile=server/out/server.js \
  --external:vscode --external:esbuild-wasm --format=cjs --platform=node \
  --banner:js="$imu_banner_with_shebang" \
  "$imu_define" \
  "$@"

# Copy tree-sitter WASM files
copy_wasm_to server/out

# Diagnostics-only grammars (MSG/TRA): parsed by the server for parse-error
# diagnostics, but unused by the format CLI - so they ship to server/out only and
# are not part of the shared copy_wasm_to helper (which also feeds format/out).
cp grammars/fallout-msg/tree-sitter-fallout_msg.wasm server/out/
cp grammars/weidu-tra/tree-sitter-weidu_tra.wasm server/out/

# Copy TD runtime declarations (used by the TD TypeScript plugin)
cp transpilers/td/src/td-runtime.d.ts server/out/
