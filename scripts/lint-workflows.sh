#!/bin/bash

# Lint GitHub Actions workflow and composite-action YAML.
#   - actionlint: GitHub Actions syntax/semantics, incl. embedded shellcheck on `run:` steps.
#   - zizmor: security-focused static analysis (unpinned refs, injection, cache poisoning, etc).
# Accepted/intentional findings are documented in zizmor.yml (workflow-level) and inline
# `# zizmor: ignore[...]` comments (composite-action-level; zizmor.yml cannot target those).
set -euo pipefail

cd "$(dirname "$0")/.."

ACTIONLINT_VERSION="1.7.12"
ZIZMOR_VERSION="1.26.1"

ACTIONLINT_CACHE_DIR=".dev/actionlint-${ACTIONLINT_VERSION}"
ACTIONLINT_BIN="$ACTIONLINT_CACHE_DIR/actionlint"

# sha256 checksums copied from actionlint's own release checksums.txt
# (https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt)
# rather than fetched at lint time, so a compromised release asset can't silently
# swap the binary this script trusts.
declare -A ACTIONLINT_SHA256=(
    [linux_amd64]="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    [linux_arm64]="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
)

actionlint_cmd=(actionlint)
if ! command -v actionlint >/dev/null 2>&1; then
    if [[ ! -x "$ACTIONLINT_BIN" ]]; then
        os="$(uname -s)"
        arch="$(uname -m)"
        if [[ "$os" != "Linux" ]]; then
            echo "lint-workflows.sh: no bundled actionlint download for OS '$os'; install actionlint and put it on PATH" >&2
            exit 1
        fi
        case "$arch" in
            x86_64) archive_arch="linux_amd64" ;;
            aarch64 | arm64) archive_arch="linux_arm64" ;;
            *)
                echo "lint-workflows.sh: no bundled actionlint download for arch '$arch'; install actionlint and put it on PATH" >&2
                exit 1
                ;;
        esac
        expected_sha256="${ACTIONLINT_SHA256[$archive_arch]}"

        tmp_dir="$(mktemp -d)"
        trap 'rm -rf "$tmp_dir"' EXIT
        url="https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${archive_arch}.tar.gz"

        echo "lint-workflows.sh: downloading actionlint v${ACTIONLINT_VERSION} (${archive_arch})" >&2
        curl -fsSL -o "$tmp_dir/actionlint.tar.gz" "$url"

        actual_sha256="$(sha256sum "$tmp_dir/actionlint.tar.gz" | cut -d' ' -f1)"
        if [[ "$actual_sha256" != "$expected_sha256" ]]; then
            echo "lint-workflows.sh: actionlint download checksum mismatch (expected $expected_sha256, got $actual_sha256)" >&2
            exit 1
        fi

        mkdir -p "$ACTIONLINT_CACHE_DIR"
        # --no-same-owner: extract as the invoking user regardless of the uid/gid
        # recorded in the archive - the release tarball's uid isn't guaranteed to
        # exist (or be chown-able to) in every CI/sandbox environment.
        tar -xzf "$tmp_dir/actionlint.tar.gz" -C "$ACTIONLINT_CACHE_DIR" --no-same-owner actionlint
        chmod +x "$ACTIONLINT_BIN"
    fi
    actionlint_cmd=("$ACTIONLINT_BIN")
fi

# actionlint with no FILES args auto-discovers the nearest .github/workflows dir
# (we already cd'd to the repo root above). It does not support composite
# action.yml files as input (they aren't workflow documents) - zizmor covers those.
"${actionlint_cmd[@]}"

# uvx pins and runs the exact zizmor version without polluting the workspace's
# own dependency tree (zizmor is a Python/Rust tool, not an npm package).
uvx "zizmor@${ZIZMOR_VERSION}" --config zizmor.yml .github/workflows/ actions/
