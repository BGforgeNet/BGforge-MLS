#!/bin/bash

# Full production build for VS Code marketplace publishing.
# Builds everything needed for the VSIX with --minify (no sourcemaps).
# When SKIP_PREPUBLISH=1, exits early (used by package.sh which builds
# first, then strips pnpm artifacts before packaging).

set -eu -o pipefail

if [ "${SKIP_PREPUBLISH:-}" = "1" ]; then
    echo "Skipping prepublish (already built by package.sh)"
    exit 0
fi

pnpm build:grammar
pnpm build:base:client --minify
pnpm build:ts-plugin --minify
pnpm build:td-plugin --minify
pnpm build:base:server --minify
pnpm build:base:webviews --minify
