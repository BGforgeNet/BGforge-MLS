#!/bin/bash

set -eu -o pipefail

# Minimal build for F5 development: client + ts-plugin + server + webviews.
# Skips CLIs (format, transpile, bin), linting, and test bundles.
pnpm build:base:client --sourcemap
pnpm build:ts-plugin --sourcemap
pnpm build:td-plugin --sourcemap
pnpm build:base:server --sourcemap
pnpm build:webviews
