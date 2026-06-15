#!/bin/bash

# Launch the extension in VS Code for the Web (code-server) for fast change review.
#
# One command: build the extension (build:dev), then start code-server with this repo loaded as an
# UNPACKED extension and the repo opened as the workspace. Because the extension is loaded unpacked
# (via --extensions-dir), iterating is just: rebuild (pnpm build:dev) then reload the browser window
# (Command Palette -> "Developer: Reload Window") - no re-packaging a VSIX.
#
# code-server is not a repo dependency. It is downloaded once (pinned version) into the gitignored
# .dev/ directory and reused on subsequent runs.
#
# Configuration (all optional, via environment):
#   CODE_SERVER_HOST     bind address (default 0.0.0.0)
#   CODE_SERVER_PORT     bind port (default 8080)
#   CODE_SERVER_AUTH     code-server auth mode: none | password (default none)
#   CODE_SERVER_VERSION  pinned code-server version to download (default below)
#   DEV_WEB_OPEN         file to open on launch (default: a small committed .pro fixture);
#                        set empty to open the workspace only
#   CODE_SERVER_TLS      serve HTTPS: 1 | 0 (default 0 = plain HTTP). The binary editor is a webview,
#                        and webviews only work in a browser "secure context": http://localhost or
#                        HTTPS-with-a-trusted-cert. The default workflow is to reach this server via a
#                        localhost forward (http://localhost:PORT), which IS a secure context - so plain
#                        HTTP is the default. A self-signed HTTPS cert does NOT help: the browser rejects
#                        the webview's service worker on an untrusted cert. Set 1 only with a genuinely
#                        trusted cert via CODE_SERVER_CERT/CODE_SERVER_CERT_KEY. See scripts/README.md.
#   CODE_SERVER_CERT     path to a trusted TLS cert (requires CODE_SERVER_CERT_KEY; only with TLS=1)
#   CODE_SERVER_CERT_KEY path to the cert's private key
#
# Flags:
#   --no-build           skip the build step and just (re)launch

set -eu -o pipefail

CS_VERSION="${CODE_SERVER_VERSION:-4.123.0}"
HOST="${CODE_SERVER_HOST:-0.0.0.0}"
PORT="${CODE_SERVER_PORT:-8080}"
AUTH="${CODE_SERVER_AUTH:-none}"
TLS="${CODE_SERVER_TLS:-0}"

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_DIR="$REPO/.dev"
EXT_DIR="$DEV_DIR/extensions"
DATA_DIR="$DEV_DIR/user-data"

DO_BUILD=1
for arg in "$@"; do
    case "$arg" in
        --no-build) DO_BUILD=0 ;;
        *) echo "unknown argument: $arg" >&2; exit 2 ;;
    esac
done

# Default file to open: a small committed fixture so the binary editor renders immediately.
DEFAULT_OPEN="$REPO/client/testFixture/proto/items/00000031.pro"
OPEN_PATH="${DEV_WEB_OPEN-$DEFAULT_OPEN}"

case "$(uname -m)" in
    x86_64 | amd64) ARCH=amd64 ;;
    aarch64 | arm64) ARCH=arm64 ;;
    *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

CS_HOME="$DEV_DIR/code-server/code-server-${CS_VERSION}-linux-${ARCH}"
CS_BIN="$CS_HOME/bin/code-server"

# Bootstrap: download the pinned code-server once into .dev/ (reused thereafter).
if [[ ! -x "$CS_BIN" ]]; then
    echo "code-server ${CS_VERSION} (${ARCH}) not present - downloading..."
    mkdir -p "$DEV_DIR/code-server"
    url="https://github.com/coder/code-server/releases/download/v${CS_VERSION}/code-server-${CS_VERSION}-linux-${ARCH}.tar.gz"
    tmp="$(mktemp)"
    curl -fSL "$url" -o "$tmp"
    tar -xzf "$tmp" -C "$DEV_DIR/code-server"
    rm -f "$tmp"
    [[ -x "$CS_BIN" ]] || { echo "download/extract failed: $CS_BIN missing" >&2; exit 1; }
    echo "installed code-server to $CS_HOME"
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
    echo "building extension (pnpm build:dev)..."
    (cd "$REPO" && pnpm build:dev)
fi

# Load the repo as an unpacked extension: a symlink under a dedicated extensions dir. Reloading the
# browser window after a rebuild picks up the new bundle without re-installing.
mkdir -p "$EXT_DIR" "$DATA_DIR"
ln -sfn "$REPO" "$EXT_DIR/bgforge-mls"

# Dash-flags first. The positional paths (workspace + file to open) go LAST: code-server's --cert is an
# optional-value flag, so a path immediately after a bare --cert would be swallowed as the cert path. By
# keeping --cert among the flags (followed by another dash-flag) it parses as valueless = self-signed.
args=(
    --bind-addr "${HOST}:${PORT}"
)

scheme=http
if [[ "$TLS" == "1" ]]; then
    scheme=https
    if [[ -n "${CODE_SERVER_CERT:-}" ]]; then
        args+=(--cert "$CODE_SERVER_CERT")
        [[ -n "${CODE_SERVER_CERT_KEY:-}" ]] && args+=(--cert-key "$CODE_SERVER_CERT_KEY")
    else
        # Bare --cert tells code-server to generate a self-signed certificate (browser shows a one-time
        # warning to click through). Needed so the binary-editor webview gets a secure context.
        args+=(--cert)
    fi
fi

args+=(
    --auth "$AUTH"
    --disable-telemetry
    --user-data-dir "$DATA_DIR"
    --extensions-dir "$EXT_DIR"
    "$REPO"
)
[[ -n "$OPEN_PATH" ]] && args+=("$OPEN_PATH")

echo "starting code-server on ${scheme}://${HOST}:${PORT} (auth=${AUTH}, tls=${TLS})"
exec "$CS_BIN" "${args[@]}"
