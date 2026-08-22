#!/bin/bash

# Resolve a WeiDU binary, downloading a pinned one if the host has none, and print its path.
#
# The grammar differential (server/test/integration/weidu-grammar-differential.test.ts) uses the real
# parser as the authority on what TP2 syntax is legal, and skips cleanly when WeiDU is absent - so
# without a binary the suite passes by never running, which is the one failure mode a test gate must not
# have. WeiDU is open source and publishes prebuilt binaries, so the gate fetches one rather than
# skipping. Callers export the printed path as WEIDU_BIN; CI additionally gets it on PATH via
# GITHUB_PATH.
#
# Pinned to an exact release and verified by checksum: the download is an unsigned third-party binary
# and a tag alone is mutable. Bump WEIDU_VERSION, WEIDU_ASSET_VERSION and the matching sha256 together.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=scripts/tool-download-lib.sh
source "$SCRIPT_DIR/tool-download-lib.sh"

WEIDU_VERSION="251.00"
# The asset names carry a shortened version ("251"), not the tag's "251.00".
WEIDU_ASSET_VERSION="251"

# Per-platform asset and its sha256, taken from the release itself. Linux and both macOS builds are
# published; Windows is not wired because nothing in this repo's gates runs there.
declare -A WEIDU_ASSETS=(
    [linux_amd64]="WeiDU-Linux-${WEIDU_ASSET_VERSION}.zip"
    [darwin_amd64]="WeiDU-Mac-${WEIDU_ASSET_VERSION}.zip"
    [darwin_arm64]="WeiDU-Mac-ARM-${WEIDU_ASSET_VERSION}.zip"
)
declare -A WEIDU_SHA256=(
    [linux_amd64]="3e1a34ec5d6e934b1d4a34541a1312d0170b120c6efe903a732415acde3bd3c0"
    [darwin_amd64]="f387eae88aca0d48842708a6a255f6cf6dabe58fc7370cb4521f1661b3a7bc1e"
    [darwin_arm64]="ba050f5a02f56865667adee7ec1c525a34313928182301081b5ec278c29096be"
)
# Both macOS archives nest under WeiDU-Mac/, the ARM one included.
declare -A WEIDU_MEMBER=(
    [linux_amd64]="WeiDU-Linux/weidu"
    [darwin_amd64]="WeiDU-Mac/weidu"
    [darwin_arm64]="WeiDU-Mac/weidu"
)

# A WeiDU already on the host wins: the devbox image bakes one, and a modder's machine has their own.
if command -v weidu >/dev/null 2>&1; then
    command -v weidu
    exit 0
fi

case "$(uname -s)" in
    Linux) os="linux" ;;
    Darwin) os="darwin" ;;
    *)
        echo "ensure-weidu.sh: no pinned WeiDU download for OS '$(uname -s)'; install weidu and put it on PATH" >&2
        exit 1
        ;;
esac
case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *)
        echo "ensure-weidu.sh: no pinned WeiDU download for arch '$(uname -m)'; install weidu and put it on PATH" >&2
        exit 1
        ;;
esac
platform="${os}_${arch}"

if [[ -z "${WEIDU_ASSETS[$platform]:-}" ]]; then
    echo "ensure-weidu.sh: no pinned WeiDU download for '$platform'; install weidu and put it on PATH" >&2
    exit 1
fi

# Beside the other downloaded tools, in the gitignored cache the packaging ignores already exclude.
weidu_bin="$ROOT_DIR/.dev/weidu-${WEIDU_VERSION}/weidu"
ensure_verified_tool "WeiDU v${WEIDU_VERSION}" \
    "https://github.com/WeiDUorg/weidu/releases/download/v${WEIDU_VERSION}/${WEIDU_ASSETS[$platform]}" \
    "${WEIDU_SHA256[$platform]}" "$weidu_bin" "${WEIDU_MEMBER[$platform]}"

# Run it once rather than trusting the unpack: a binary that unpacked but will not execute is
# indistinguishable from "no WeiDU installed" to the suite, i.e. a green run that tested nothing.
"$weidu_bin" --version >/dev/null

# CI resolves `weidu` from PATH; GITHUB_PATH applies from the next step onward.
if [[ -n "${GITHUB_PATH:-}" ]]; then
    dirname "$weidu_bin" >>"$GITHUB_PATH"
fi

echo "$weidu_bin"
