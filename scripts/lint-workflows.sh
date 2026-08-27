#!/bin/bash

# Lint GitHub Actions workflow and composite-action YAML.
#   - actionlint: GitHub Actions syntax/semantics, incl. embedded shellcheck on `run:` steps.
#   - zizmor: security-focused static analysis (unpinned refs, injection, cache poisoning, etc).
# Accepted/intentional findings are documented in zizmor.yml (workflow-level) and inline
# `# zizmor: ignore[...]` comments (composite-action-level; zizmor.yml cannot target those).
#
# Both linters run from pinned, checksum-verified release binaries downloaded on demand
# (see tool-download-lib.sh) - no uv/pipx/pip needed on the host.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

# shellcheck source=scripts/tool-download-lib.sh
source "$SCRIPT_DIR/tool-download-lib.sh"

ACTIONLINT_VERSION="1.7.12"
ZIZMOR_VERSION="1.29.0"

ACTIONLINT_CACHE_DIR=".dev/actionlint-${ACTIONLINT_VERSION}"
ACTIONLINT_BIN="$ACTIONLINT_CACHE_DIR/actionlint"
ZIZMOR_CACHE_DIR=".dev/zizmor-${ZIZMOR_VERSION}"
ZIZMOR_BIN="$ZIZMOR_CACHE_DIR/zizmor"

# sha256 checksums of the pinned release tarballs. actionlint's are copied from its published
# checksums.txt (https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt);
# zizmor publishes no checksums manifest, so its hashes are pinned from the sha256 of the
# immutable v${ZIZMOR_VERSION} release assets (a mismatch on re-download means the asset changed).
declare -A ACTIONLINT_SHA256=(
    [linux_amd64]="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    [linux_arm64]="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
)
declare -A ZIZMOR_SHA256=(
    # keys quoted so shfmt doesn't read the hyphens as arithmetic and reformat them
    ["x86_64-unknown-linux-gnu"]="dd96df044a6e8538d5f423790f453bdd03d49e5b2bcc38214acc41a2f1297839"
    ["aarch64-unknown-linux-gnu"]="415eaa7c0a06479a701b8e44a3e812c1047decc848ec4bede7bd6bbf49f22d20"
)

os="$(uname -s)"
arch="$(uname -m)"

# --- actionlint: GitHub Actions syntax/semantics (+ embedded shellcheck on `run:` steps) ---
actionlint_cmd=(actionlint)
if ! command -v actionlint >/dev/null 2>&1; then
    if [[ "$os" != "Linux" ]]; then
        echo "lint-workflows.sh: no bundled actionlint download for OS '$os'; install actionlint and put it on PATH" >&2
        exit 1
    fi
    case "$arch" in
        x86_64) al_arch="linux_amd64" ;;
        aarch64 | arm64) al_arch="linux_arm64" ;;
        *)
            echo "lint-workflows.sh: no bundled actionlint download for arch '$arch'; install actionlint and put it on PATH" >&2
            exit 1
            ;;
    esac
    ensure_verified_tool "actionlint v${ACTIONLINT_VERSION}" \
        "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${al_arch}.tar.gz" \
        "${ACTIONLINT_SHA256[$al_arch]}" "$ACTIONLINT_BIN" actionlint
    actionlint_cmd=("$ACTIONLINT_BIN")
fi

# --- zizmor: security-focused static analysis (a Rust tool shipped as per-arch binaries) ---
zizmor_cmd=(zizmor)
if ! command -v zizmor >/dev/null 2>&1; then
    if [[ "$os" != "Linux" ]]; then
        echo "lint-workflows.sh: no bundled zizmor download for OS '$os'; install zizmor and put it on PATH" >&2
        exit 1
    fi
    case "$arch" in
        x86_64) zz_arch="x86_64-unknown-linux-gnu" ;;
        aarch64 | arm64) zz_arch="aarch64-unknown-linux-gnu" ;;
        *)
            echo "lint-workflows.sh: no bundled zizmor download for arch '$arch'; install zizmor and put it on PATH" >&2
            exit 1
            ;;
    esac
    ensure_verified_tool "zizmor v${ZIZMOR_VERSION}" \
        "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${zz_arch}.tar.gz" \
        "${ZIZMOR_SHA256[$zz_arch]}" "$ZIZMOR_BIN" zizmor
    zizmor_cmd=("$ZIZMOR_BIN")
fi

# actionlint with no FILES args auto-discovers the nearest .github/workflows dir (we already
# cd'd to the repo root above). It does not support composite action.yml files as input (they
# aren't workflow documents) - zizmor covers those.
"${actionlint_cmd[@]}"

# --offline states the mode zizmor already runs in: with no GH_TOKEN it falls back to offline and
# prints a notice on every run. The audits it disables need GitHub API access, and the alternative -
# putting a token in the environment of the whole `pnpm test:all` step this runs inside - hands it to
# every suite in the gate, which is a worse trade than losing those audits.
"${zizmor_cmd[@]}" --offline --config zizmor.yml .github/workflows/ actions/
