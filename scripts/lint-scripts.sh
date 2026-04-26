#!/bin/bash

set -eu -o pipefail

# Typecheck and lint scripts/ utility code.
pnpm exec tsc --project scripts/tsconfig.json

pnpm exec oxlint scripts/*/src/**/*.ts scripts/*/test/**/*.ts
