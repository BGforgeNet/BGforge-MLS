#!/bin/bash

# Lint all project-owned shell scripts: shellcheck for correctness, shfmt for format.
# Uses git ls-files to automatically respect .gitignore exclusions.
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# shellcheck source=scripts/tool-download-lib.sh
source "$SCRIPT_DIR/tool-download-lib.sh"

# shfmt isn't preinstalled on GitHub-hosted runners (shellcheck is), so fetch a pinned,
# checksum-verified binary when it's absent - the same version the devbox ships, so a
# local pass and a CI pass format-agree. mvdan/sh publishes no checksums manifest, so the
# hashes are pinned from the sha256 of the immutable v3.13.1 release binaries.
SHFMT_VERSION="3.13.1"
SHFMT_CACHE_DIR=".dev/shfmt-${SHFMT_VERSION}"
SHFMT_BIN="$SHFMT_CACHE_DIR/shfmt"
declare -A SHFMT_SHA256=(
    [linux_amd64]="fb096c5d1ac6beabbdbaa2874d025badb03ee07929f0c9ff67563ce8c75398b1"
    [linux_arm64]="32d92acaa5cd8abb29fc49dac123dc412442d5713967819d8af2c29f1b3857c7"
)

shfmt_cmd=(shfmt)
if ! command -v shfmt >/dev/null 2>&1; then
    os="$(uname -s)"
    arch="$(uname -m)"
    if [[ "$os" != "Linux" ]]; then
        echo "lint-shell.sh: no bundled shfmt download for OS '$os'; install shfmt and put it on PATH" >&2
        exit 1
    fi
    case "$arch" in
        x86_64) shfmt_arch="linux_amd64" ;;
        aarch64 | arm64) shfmt_arch="linux_arm64" ;;
        *)
            echo "lint-shell.sh: no bundled shfmt download for arch '$arch'; install shfmt and put it on PATH" >&2
            exit 1
            ;;
    esac
    ensure_verified_tool "shfmt v${SHFMT_VERSION}" \
        "https://github.com/mvdan/sh/releases/download/v${SHFMT_VERSION}/shfmt_v${SHFMT_VERSION}_${shfmt_arch}" \
        "${SHFMT_SHA256[$shfmt_arch]}" "$SHFMT_BIN"
    shfmt_cmd=("$SHFMT_BIN")
fi

# git ls-files respects .gitignore automatically
# -c: include cached/tracked files
# -o: include other/untracked files (but still respect .gitignore)
# --exclude-standard: use standard git exclude rules
git ls-files -co --exclude-standard '*.sh' | xargs shellcheck -x

# Format check: -i 4 matches the .editorconfig 4-space shell indent, -ci indents
# switch-case bodies. `shfmt -d` exits non-zero on any unformatted file (fix with
# `shfmt -i 4 -ci -w <file>`).
git ls-files -co --exclude-standard '*.sh' | xargs "${shfmt_cmd[@]}" -i 4 -ci -d
