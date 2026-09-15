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
ZIZMOR_VERSION="1.30.0"

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
    ["x86_64-unknown-linux-gnu"]="ec8c95cd800845abb9bbc5f377ec7c57d2eb8e2386a00a201d3a74ee4092e5ed"
    ["aarch64-unknown-linux-gnu"]="018a024d6b6d09733b07f6ef42838d984c23ec04bc9b2acd55f7d67826aeafe5"
)

os="$(uname -s)"
arch="$(uname -m)"

# The pinned binaries win over anything on PATH: both tools are versioned linters whose finding
# set moves between releases, so letting the host image pick the version makes the gate's verdict
# depend on where it runs. A platform with no pinned build has to supply its own.

# --- actionlint: GitHub Actions syntax/semantics (+ embedded shellcheck on `run:` steps) ---
actionlint_cmd=(actionlint)
al_arch=""
if [[ "$os" == "Linux" ]]; then
    case "$arch" in
        x86_64) al_arch="linux_amd64" ;;
        aarch64 | arm64) al_arch="linux_arm64" ;;
    esac
fi
if [[ -n "$al_arch" ]]; then
    ensure_verified_tool "actionlint v${ACTIONLINT_VERSION}" \
        "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${al_arch}.tar.gz" \
        "${ACTIONLINT_SHA256[$al_arch]}" "$ACTIONLINT_BIN" actionlint
    actionlint_cmd=("$ACTIONLINT_BIN")
elif ! command -v actionlint >/dev/null 2>&1; then
    echo "lint-workflows.sh: no pinned actionlint build for ${os}/${arch}; install actionlint and put it on PATH" >&2
    exit 1
fi

# --- zizmor: security-focused static analysis (a Rust tool shipped as per-arch binaries) ---
zizmor_cmd=(zizmor)
zz_arch=""
if [[ "$os" == "Linux" ]]; then
    case "$arch" in
        x86_64) zz_arch="x86_64-unknown-linux-gnu" ;;
        aarch64 | arm64) zz_arch="aarch64-unknown-linux-gnu" ;;
    esac
fi
if [[ -n "$zz_arch" ]]; then
    ensure_verified_tool "zizmor v${ZIZMOR_VERSION}" \
        "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${zz_arch}.tar.gz" \
        "${ZIZMOR_SHA256[$zz_arch]}" "$ZIZMOR_BIN" zizmor
    zizmor_cmd=("$ZIZMOR_BIN")
elif ! command -v zizmor >/dev/null 2>&1; then
    echo "lint-workflows.sh: no pinned zizmor build for ${os}/${arch}; install zizmor and put it on PATH" >&2
    exit 1
fi

# --- shellcheck: actionlint shells out to it for embedded `run:` blocks ---
# Same pin lint-shell.sh runs over the project's own scripts (tool-download-lib.sh), so a `run:`
# block and a .sh file are held to one shellcheck version. The path is absolute so it does not
# depend on the directory actionlint spawns shellcheck from.
shellcheck_for_actionlint="shellcheck"
if ensure_pinned_shellcheck; then
    shellcheck_for_actionlint="$PWD/$PINNED_SHELLCHECK"
fi

# The pinned binaries live under .dev/<tool>-<version>/, so the resolved paths name the versions
# the gate ran with; a bare name means the host's own copy.
echo "lint-workflows.sh: using ${actionlint_cmd[0]}, ${zizmor_cmd[0]}, ${shellcheck_for_actionlint}"

# actionlint with no FILES args auto-discovers the nearest .github/workflows dir (we already
# cd'd to the repo root above). It does not support composite action.yml files as input (they
# aren't workflow documents) - zizmor covers those.
"${actionlint_cmd[@]}" -shellcheck "$shellcheck_for_actionlint"

# zizmor's online audit rules need GitHub API access. With a token in the environment they run;
# without one zizmor falls back to offline anyway, and asking for --offline explicitly keeps the
# notice it prints in that case out of the output. CI gives the token to a workflow-lint step of
# its own rather than to the `pnpm test:all` step this also runs inside, which would hand it to
# every suite in the gate.
zizmor_args=(--config zizmor.yml)
if [[ -z "${GH_TOKEN:-}${GITHUB_TOKEN:-}${ZIZMOR_GITHUB_TOKEN:-}" ]]; then
    zizmor_args+=(--offline)
fi
"${zizmor_cmd[@]}" "${zizmor_args[@]}" .github/workflows/ actions/
