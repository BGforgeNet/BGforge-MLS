#!/bin/bash

# Shared helper for the lint scripts: fetch a pinned external tool from a GitHub release
# and verify its sha256 before use. This lets the workflow- and shell-lint gates run
# identically in CI and on the devbox without the tool being pre-installed on the host -
# GitHub-hosted runners and the devbox each ship a different subset (e.g. shellcheck but
# not shfmt, or the reverse), so a self-contained, checksum-verified download is the one
# path that works everywhere. Sourced by lint-workflows.sh (actionlint, zizmor),
# lint-shell.sh (shfmt) and ensure-weidu.sh; do not execute it directly.

# ensure_verified_tool LABEL URL EXPECTED_SHA256 DEST_BIN [ARCHIVE_MEMBER]
#
# Install an executable at DEST_BIN if it is not already present. The download is verified
# against EXPECTED_SHA256 (a mismatch is fatal, so a compromised release asset can't
# silently swap the binary). If ARCHIVE_MEMBER is given, URL is an archive - .zip, or
# .tar.gz otherwise - and that single member is extracted; without it URL is a raw binary
# copied directly into place. A zip member is flattened to its basename, since a release
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
        # --no-same-owner: extract as the invoking user regardless of the uid/gid recorded
        # in the archive - the release tarball's uid isn't guaranteed to exist (or be
        # chown-able to) in every CI/sandbox environment.
        tar -xzf "$tmp_dir/download" -C "$(dirname "$dest_bin")" --no-same-owner "$archive_member"
    fi
    chmod +x "$dest_bin"
    rm -rf "$tmp_dir"
}
