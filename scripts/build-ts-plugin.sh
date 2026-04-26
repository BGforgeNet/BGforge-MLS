#!/bin/bash

set -e

# Build a TypeScript Language Service Plugin.
# Usage: build-ts-plugin.sh <plugin-name>
#   plugin-name: e.g. tssl-plugin or td-plugin
#
# For VSCode: installs as a local node_modules package so tsserver can load it.
# For npm: bundled into @bgforge/mls-server by publish-server.sh.
# Source lives in plugins/<plugin-name>/src/.

set -eu -o pipefail

plugin="${1:?Usage: build-ts-plugin.sh <plugin-name>}"

mkdir -p "node_modules/bgforge-${plugin}"
echo "{\"name\":\"bgforge-${plugin}\",\"main\":\"index.js\"}" >"node_modules/bgforge-${plugin}/package.json"

esbuild "./plugins/${plugin}/src/index.ts" \
    --bundle \
    --outfile="node_modules/bgforge-${plugin}/index.js" \
    --format=cjs \
    --platform=node \
    "${@:2}"
