#!/bin/bash

set -eu -o pipefail

# Typecheck scripts/ utility code. Linting is already covered by the root
# `oxlint` run in `pnpm lint` (no scripts/ exclusion in .oxlintrc.json's
# ignorePatterns), so a second, narrower oxlint invocation here was redundant
# and additionally missed files nested more than one level deep (the `**`
# glob is single-level without bash's globstar option).
tsc --project scripts/tsconfig.json
