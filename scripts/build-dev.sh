#!/bin/bash

set -eu -o pipefail

# Minimal build for F5 development: client (extension entry + TS plugins +
# webview bundles) + server. Skips CLIs (format, transpile, bin), linting,
# and test bundles.
pnpm build:client
pnpm build:base:server --sourcemap
