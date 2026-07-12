#!/bin/bash

# Lint all project-owned shell scripts: shellcheck for correctness, shfmt for format.
# Uses git ls-files to automatically respect .gitignore exclusions.
set -eu -o pipefail

cd "$(dirname "$0")/.."

# git ls-files respects .gitignore automatically
# -c: include cached/tracked files
# -o: include other/untracked files (but still respect .gitignore)
# --exclude-standard: use standard git exclude rules
git ls-files -co --exclude-standard '*.sh' | xargs shellcheck -x

# Format check: -i 4 matches the .editorconfig 4-space shell indent, -ci indents
# switch-case bodies. `shfmt -d` exits non-zero on any unformatted file (fix with
# `shfmt -i 4 -ci -w <file>`).
git ls-files -co --exclude-standard '*.sh' | xargs shfmt -i 4 -ci -d
