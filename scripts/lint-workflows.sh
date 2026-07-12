#!/bin/bash

# Lint GitHub Actions workflow and composite-action YAML.
#   - actionlint: GitHub Actions syntax/semantics, incl. embedded shellcheck on `run:` steps.
#   - zizmor: security-focused static analysis (unpinned refs, injection, cache poisoning, etc).
# Accepted/intentional findings are documented in zizmor.yml (workflow-level) and inline
# `# zizmor: ignore[...]` comments (composite-action-level; zizmor.yml cannot target those).
#
# Both linters run from pinned, checksum-verified release binaries downloaded on demand -
# no uv/pipx/pip needed on the host. GitHub-hosted runners ship pipx but not uv, and the
# devbox ships uv but not pipx, so a self-contained binary download is the one path that
# works identically in CI and locally.
set -euo pipefail

cd "$(dirname "$0")/.."

ACTIONLINT_VERSION="1.7.12"
ZIZMOR_VERSION="1.26.1"

ACTIONLINT_CACHE_DIR=".dev/actionlint-${ACTIONLINT_VERSION}"
ACTIONLINT_BIN="$ACTIONLINT_CACHE_DIR/actionlint"
ZIZMOR_CACHE_DIR=".dev/zizmor-${ZIZMOR_VERSION}"
ZIZMOR_BIN="$ZIZMOR_CACHE_DIR/zizmor"

# sha256 checksums of the pinned release tarballs, so a compromised release asset can't
# silently swap the binary this script trusts. actionlint's are copied from its published
# checksums.txt (https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_checksums.txt);
# zizmor publishes no checksums manifest, so its hashes are pinned from the sha256 of the
# immutable v${ZIZMOR_VERSION} release assets (a mismatch on re-download means the asset changed).
declare -A ACTIONLINT_SHA256=(
    [linux_amd64]="8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
    [linux_arm64]="325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6"
)
declare -A ZIZMOR_SHA256=(
    # keys quoted so shfmt doesn't read the hyphens as arithmetic and reformat them
    ["x86_64-unknown-linux-gnu"]="8556289a64e7aaf2400cd516f61a471aa91c5902cc56ad96a82fd12f90c2ef73"
    ["aarch64-unknown-linux-gnu"]="711f5af366b299128f9a04b1470e37d990b41fbd21f14a1a4148d25004a83762"
)

# Download a single executable member from a GitHub release tarball, verify it against a
# pinned sha256, and extract it into a cache dir. Args: label url expected_sha256 cache_dir member.
download_verified_binary() {
    local label="$1" url="$2" expected_sha256="$3" cache_dir="$4" member="$5"
    local tmp_dir
    tmp_dir="$(mktemp -d)"

    echo "lint-workflows.sh: downloading ${label} (${url##*/})" >&2
    curl -fsSL -o "$tmp_dir/archive.tar.gz" "$url"

    local actual_sha256
    actual_sha256="$(sha256sum "$tmp_dir/archive.tar.gz" | cut -d' ' -f1)"
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
        echo "lint-workflows.sh: ${label} download checksum mismatch (expected $expected_sha256, got $actual_sha256)" >&2
        rm -rf "$tmp_dir"
        return 1
    fi

    mkdir -p "$cache_dir"
    # --no-same-owner: extract as the invoking user regardless of the uid/gid recorded in
    # the archive - the release tarball's uid isn't guaranteed to exist (or be chown-able
    # to) in every CI/sandbox environment.
    tar -xzf "$tmp_dir/archive.tar.gz" -C "$cache_dir" --no-same-owner "$member"
    chmod +x "$cache_dir/$member"
    rm -rf "$tmp_dir"
}

os="$(uname -s)"
arch="$(uname -m)"

# --- actionlint: GitHub Actions syntax/semantics (+ embedded shellcheck on `run:` steps) ---
actionlint_cmd=(actionlint)
if ! command -v actionlint >/dev/null 2>&1; then
    if [[ ! -x "$ACTIONLINT_BIN" ]]; then
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
        download_verified_binary "actionlint v${ACTIONLINT_VERSION}" \
            "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_${al_arch}.tar.gz" \
            "${ACTIONLINT_SHA256[$al_arch]}" "$ACTIONLINT_CACHE_DIR" actionlint
    fi
    actionlint_cmd=("$ACTIONLINT_BIN")
fi

# --- zizmor: security-focused static analysis (a Rust tool shipped as per-arch binaries) ---
zizmor_cmd=(zizmor)
if ! command -v zizmor >/dev/null 2>&1; then
    if [[ ! -x "$ZIZMOR_BIN" ]]; then
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
        download_verified_binary "zizmor v${ZIZMOR_VERSION}" \
            "https://github.com/zizmorcore/zizmor/releases/download/v${ZIZMOR_VERSION}/zizmor-${zz_arch}.tar.gz" \
            "${ZIZMOR_SHA256[$zz_arch]}" "$ZIZMOR_CACHE_DIR" zizmor
    fi
    zizmor_cmd=("$ZIZMOR_BIN")
fi

# actionlint with no FILES args auto-discovers the nearest .github/workflows dir (we already
# cd'd to the repo root above). It does not support composite action.yml files as input (they
# aren't workflow documents) - zizmor covers those.
"${actionlint_cmd[@]}"

"${zizmor_cmd[@]}" --config zizmor.yml .github/workflows/ actions/
