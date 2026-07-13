#!/bin/bash

# Shared helper for the lint scripts: fetch a pinned external tool from a GitHub release
# and verify its sha256 before use. This lets the workflow- and shell-lint gates run
# identically in CI and on the devbox without the tool being pre-installed on the host -
# GitHub-hosted runners and the devbox each ship a different subset (e.g. shellcheck but
# not shfmt, or the reverse), so a self-contained, checksum-verified download is the one
# path that works everywhere. Sourced by lint-workflows.sh (actionlint, zizmor) and
# lint-shell.sh (shfmt); do not execute it directly.

# ensure_verified_tool LABEL URL EXPECTED_SHA256 DEST_BIN [TAR_MEMBER]
#
# Install an executable at DEST_BIN if it is not already present. The download is verified
# against EXPECTED_SHA256 (a mismatch is fatal, so a compromised release asset can't
# silently swap the binary). If TAR_MEMBER is given, URL is a .tar.gz and that single
# member is extracted; otherwise URL is a raw binary copied directly into place.
ensure_verified_tool() {
    local label="$1" url="$2" expected_sha256="$3" dest_bin="$4" tar_member="${5:-}"
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
    if [[ -n "$tar_member" ]]; then
        # --no-same-owner: extract as the invoking user regardless of the uid/gid recorded
        # in the archive - the release tarball's uid isn't guaranteed to exist (or be
        # chown-able to) in every CI/sandbox environment.
        tar -xzf "$tmp_dir/download" -C "$(dirname "$dest_bin")" --no-same-owner "$tar_member"
    else
        cp "$tmp_dir/download" "$dest_bin"
    fi
    chmod +x "$dest_bin"
    rm -rf "$tmp_dir"
}
