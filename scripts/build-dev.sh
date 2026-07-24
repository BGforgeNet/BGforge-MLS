#!/bin/bash

set -eu -o pipefail

# Minimal build for F5 development: client (extension entry + TS plugins +
# webview bundles) + server. Skips CLIs (format, transpile, bin), linting,
# and test bundles.

# @bgforge/image is source-consumed by the client (tsconfig + vitest aliases
# resolve it to image/src), like @bgforge/binary - no separate build step here.
pnpm build:client
pnpm build:base:server --sourcemap
