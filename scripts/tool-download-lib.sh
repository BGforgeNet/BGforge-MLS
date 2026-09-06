#!/bin/bash

# Shared helper for the lint scripts: fetch a pinned external tool from a GitHub release
# and verify its sha256 before use. This lets the workflow- and shell-lint gates run
# identically in CI and on the devbox without the tool being pre-installed on the host -
# GitHub-hosted runners and the devbox each ship a different subset (e.g. shellcheck but
# not shfmt, or the reverse), so a self-contained, checksum-verified download is the one
# path that works everywhere. Sourced by lint-workflows.sh (actionlint, zizmor),
# lint-shell.sh (shfmt) and ensure-weidu.sh; do not execute it directly.
#
# It also owns the shellcheck pin, because two gates run shellcheck: lint-shell.sh over the
# project's own scripts, and lint-workflows.sh through actionlint's `-shellcheck` on embedded
# `run:` blocks. One home keeps them on the same version.

# ensure_verified_tool LABEL URL EXPECTED_SHA256 DEST_BIN [ARCHIVE_MEMBER]
#
# Install an executable at DEST_BIN if it is not already present. The download is verified
# against EXPECTED_SHA256 (a mismatch is fatal, so a compromised release asset can't
# silently swap the binary). If ARCHIVE_MEMBER is given, URL is an archive - .zip, or
# .tar.gz otherwise - and that single member is extracted; without it URL is a raw binary
# copied directly into place. An archive member is flattened to its basename, since a release
# archive nests the binary under its own top-level directory and DEST_BIN names where it
# should land.
ensure_verified_tool() {
    local label="$1" url="$2" expected_sha256="$3" dest_bin="$4" archive_member="${5:-}"
    if [[ -x "$dest_bin" ]]; then
        return 0
    fi

    local tmp_dir
    tmp_dir="$(mktemp -d)"

    echo "tool-download: fetching ${label} (${url##*/})" >&2
    curl -fsSL -o "$tmp_dir/download" "$url"

    local actual_sha256
    actual_sha256="$(sha256sum "$tmp_dir/download" | cut -d' ' -f1)"
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
        echo "tool-download: ${label} checksum mismatch (expected $expected_sha256, got $actual_sha256)" >&2
        rm -rf "$tmp_dir"
        return 1
    fi

    mkdir -p "$(dirname "$dest_bin")"
    if [[ -z "$archive_member" ]]; then
        cp "$tmp_dir/download" "$dest_bin"
    elif [[ "$url" == *.zip ]]; then
        if ! command -v unzip >/dev/null 2>&1; then
            echo "tool-download: ${label} ships a .zip and unzip is not on PATH; install unzip" >&2
            rm -rf "$tmp_dir"
            return 1
        fi
        unzip -q -o -j "$tmp_dir/download" "$archive_member" -d "$(dirname "$dest_bin")"
    else
        # --strip-components drops the member's leading directories so it lands at DEST_BIN
        # rather than under a version-named subdirectory.
        # --no-same-owner: extract as the invoking user regardless of the uid/gid recorded
        # in the archive - the release tarball's uid isn't guaranteed to exist (or be
        # chown-able to) in every CI/sandbox environment.
        local member_slashes="${archive_member//[^\/]/}"
        tar -xzf "$tmp_dir/download" -C "$(dirname "$dest_bin")" --no-same-owner \
            --strip-components="${#member_slashes}" "$archive_member"
    fi
    chmod +x "$dest_bin"
    rm -rf "$tmp_dir"
}

# GitHub-hosted runners preinstall shellcheck, so the pinned binary has to win over PATH:
# otherwise a runner-image bump changes which checks the gates run. koalaman/shellcheck
# publishes no checksums manifest, so the hashes are pinned from the sha256 of the immutable
# v0.11.0 release tarballs.
SHELLCHECK_VERSION="0.11.0"
declare -A SHELLCHECK_SHA256=(
    ["linux.x86_64"]="b7af85e41cc99489dcc21d66c6d5f3685138f06d34651e6d34b42ec6d54fe6f6"
    ["linux.aarch64"]="68a8133197a50beb8803f8d42f9908d1af1c5540d4bb05fdfca8c1fa47decefc"
)

# Set PINNED_SHELLCHECK to the repo-root-relative path of the pinned shellcheck, downloading it on
# first use; on a platform with no pinned build leave it empty and return 1, so the caller can
# decide whether the host's own shellcheck will do. It answers through a global rather than stdout
# because a command substitution would swallow the abort below into a subshell.
export PINNED_SHELLCHECK=""
ensure_pinned_shellcheck() {
    local sc_arch=""
    if [[ "$(uname -s)" == "Linux" ]]; then
        case "$(uname -m)" in
            x86_64) sc_arch="linux.x86_64" ;;
            aarch64 | arm64) sc_arch="linux.aarch64" ;;
        esac
    fi
    [[ -n "$sc_arch" ]] || return 1

    local dest_bin=".dev/shellcheck-${SHELLCHECK_VERSION}/shellcheck"
    # A failed download or a checksum mismatch aborts the caller rather than returning: falling
    # back to the host's shellcheck there would run a version the pin does not vouch for.
    ensure_verified_tool "shellcheck v${SHELLCHECK_VERSION}" \
        "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.${sc_arch}.tar.gz" \
        "${SHELLCHECK_SHA256[$sc_arch]}" "$dest_bin" "shellcheck-v${SHELLCHECK_VERSION}/shellcheck" || exit 1
    export PINNED_SHELLCHECK="$dest_bin"
}
