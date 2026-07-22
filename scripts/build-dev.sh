#!/bin/bash

set -eu -o pipefail

# Minimal build for F5 development: client (extension entry + TS plugins +
# webview bundles) + server. Skips CLIs (format, transpile, bin), linting,
# and test bundles.

# @bgforge/image is built before the client so a broken library build fails
# here rather than surfacing downstream.
pnpm --filter @bgforge/image build
pnpm build:client
pnpm build:base:server --sourcemap
