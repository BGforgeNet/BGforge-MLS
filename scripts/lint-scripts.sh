#!/bin/bash

set -e

# Typecheck and lint scripts/ utility code.
pnpm exec tsc --project scripts/tsconfig.json

pnpm exec oxlint scripts/*/src/**/*.ts scripts/*/test/**/*.ts
