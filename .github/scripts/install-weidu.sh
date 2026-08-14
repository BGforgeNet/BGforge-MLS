#!/bin/bash
# Install a pinned WeiDU binary onto PATH for the grammar differential suite
# (server/test/integration/weidu-grammar-differential.test.ts), which uses the real parser as the
# authority on what TP2 syntax is legal. The suite skips cleanly when WeiDU is absent, so a failure
# here must be loud rather than silently degrading the run into a no-op.
#
# Pinned to an exact release and verified by checksum: the download is an unsigned third-party binary
# fetched into CI, and the tag alone is mutable.

set -euo pipefail

WEIDU_VERSION="251.00"
WEIDU_ASSET="WeiDU-Linux-251.zip"
WEIDU_SHA256="3e1a34ec5d6e934b1d4a34541a1312d0170b120c6efe903a732415acde3bd3c0"
WEIDU_URL="https://github.com/WeiDUorg/weidu/releases/download/v${WEIDU_VERSION}/${WEIDU_ASSET}"

# RUNNER_TEMP keeps the download out of the checkout, where the repo's own manifests would govern it.
# Installing into a temp dir added to GITHUB_PATH also avoids assuming a system bin dir is writable.
work="${RUNNER_TEMP:-/tmp}/weidu"
bindir="$work/bin"
mkdir -p "$bindir"

curl --fail --location --silent --show-error --retry 3 --retry-connrefused \
    --output "$work/$WEIDU_ASSET" "$WEIDU_URL"

echo "${WEIDU_SHA256}  $work/$WEIDU_ASSET" | sha256sum --check --strict

unzip -q -o "$work/$WEIDU_ASSET" -d "$work"
install -m 0755 "$work/WeiDU-Linux/weidu" "$bindir/weidu"

# Fail here rather than letting the suite skip: a WeiDU that unpacked but will not run would otherwise
# look identical to "no WeiDU installed", which is a green run that tested nothing.
"$bindir/weidu" --version

# Later steps resolve `weidu` from PATH; GITHUB_PATH applies from the next step onward.
if [[ -n "${GITHUB_PATH:-}" ]]; then
    echo "$bindir" >>"$GITHUB_PATH"
fi
