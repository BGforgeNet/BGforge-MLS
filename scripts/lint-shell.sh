#!/bin/bash

# Lint all project-owned shell scripts: shellcheck for correctness, shfmt for format.
# Uses git ls-files to automatically respect .gitignore exclusions.
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# shellcheck source=scripts/tool-download-lib.sh
source "$SCRIPT_DIR/tool-download-lib.sh"

os="$(uname -s)"
arch="$(uname -m)"

# The shellcheck pin lives in tool-download-lib.sh, shared with lint-workflows.sh, which hands
# the same binary to actionlint for the shellcheck it runs on embedded `run:` blocks. A platform
# with no pinned build falls back to the host's own shellcheck.
shellcheck_cmd=(shellcheck)
if ensure_pinned_shellcheck; then
    shellcheck_cmd=("$PINNED_SHELLCHECK")
elif ! command -v shellcheck >/dev/null 2>&1; then
    echo "lint-shell.sh: no pinned shellcheck build for ${os}/${arch}; install shellcheck and put it on PATH" >&2
    exit 1
fi
# The pinned binary lives under .dev/shellcheck-<version>/, so the resolved path names the
# version the gate ran with; a bare name means the host's own copy.
echo "lint-shell.sh: using ${shellcheck_cmd[0]}"

# shfmt isn't preinstalled on GitHub-hosted runners (shellcheck is), so fetch a pinned,
# checksum-verified binary when it's absent - the same version the devbox ships, so a
# local pass and a CI pass format-agree. mvdan/sh publishes no checksums manifest, so the
# hashes are pinned from the sha256 of the immutable v3.14.0 release binaries.
SHFMT_VERSION="3.14.0"
SHFMT_CACHE_DIR=".dev/shfmt-${SHFMT_VERSION}"
SHFMT_BIN="$SHFMT_CACHE_DIR/shfmt"
declare -A SHFMT_SHA256=(
    [linux_amd64]="fe42021c7272ef2d67ea36cbc3031683c625d0badec733ef3a57b567246a0b66"
    [linux_arm64]="8029959a945b5c6f2bc92ce53fca5cf0384c811cc0884b25b196a093a005657a"
)

shfmt_cmd=(shfmt)
if ! command -v shfmt >/dev/null 2>&1; then
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
git ls-files -zco --exclude-standard '*.sh' | xargs -0r "${shellcheck_cmd[@]}" -x

# Format check: -i 4 matches the .editorconfig 4-space shell indent, -ci indents
# switch-case bodies. `shfmt -d` exits non-zero on any unformatted file (fix with
# `shfmt -i 4 -ci -w <file>`).
git ls-files -zco --exclude-standard '*.sh' | xargs -0r "${shfmt_cmd[@]}" -i 4 -ci -d
