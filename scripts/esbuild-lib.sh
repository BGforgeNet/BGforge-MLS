# shellcheck shell=bash
# Shared esbuild helpers for build scripts.
# Source this file; do not execute it directly.
# Provides variables for the import.meta.url shim and a WASM copy helper.
#
# Usage:
#   source "$(dirname "$0")/esbuild-lib.sh"
#
# Rationale for the __imu shim:
#   web-tree-sitter needs import.meta.url to resolve WASM file paths,
#   but esbuild's CJS output shims import.meta as an empty object.
#   --banner + --define works reliably with --minify (unlike the old sed approach).

# JS banner without shebang - for library bundles (server, format CLI, transpile CLI).
# Pass as: --banner:js="$imu_banner"
# shellcheck disable=SC2034  # exported for use by sourcing scripts
imu_banner='var __imu=require("url").pathToFileURL(__filename).href;'

# JS banner with shebang prefix - for executable entry points.
# Pass as: --banner:js="$imu_banner_with_shebang"
# shellcheck disable=SC2034  # exported for use by sourcing scripts
imu_banner_with_shebang='#!/usr/bin/env node
var __imu=require("url").pathToFileURL(__filename).href;'

# define flag replacing import.meta.url with __imu.
# Pass as: "$imu_define"
# shellcheck disable=SC2034  # exported for use by sourcing scripts
imu_define='--define:import.meta.url=__imu'

# Copy the 4 tree-sitter grammar WASMs and web-tree-sitter.wasm to a destination directory.
# Usage: copy_wasm_to <dest-dir>
copy_wasm_to() {
    local dest="$1"
    cp grammars/fallout-ssl/tree-sitter-ssl.wasm "$dest/"
    cp grammars/weidu-baf/tree-sitter-baf.wasm "$dest/"
    cp grammars/weidu-d/tree-sitter-weidu_d.wasm "$dest/"
    cp grammars/weidu-tp2/tree-sitter-weidu_tp2.wasm "$dest/"
    cp server/node_modules/web-tree-sitter/web-tree-sitter.wasm "$dest/"
}
