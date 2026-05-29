#!/bin/bash

# Shared publish tail for the @bgforge library packages (binary, format,
# transpile, server). Each publish-<pkg>.sh does its own build, then calls
# do_publish for the identical "cd into the package, attest, refuse a dirty
# tree, pnpm publish" sequence.

# do_publish <display-name> <subdir> [extra pnpm publish args...]
# Run from the repo root. cd's into <subdir>, then publishes it to npm.
do_publish() {
    local display="$1" subdir="$2"
    shift 2

    echo ""
    echo "=== Publishing $display ==="
    cd "$subdir" || exit 1

    # --provenance adds a signed attestation; requires GitHub Actions OIDC
    # (id-token: write), so it is only added when running under Actions.
    local provenance=""
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        provenance="--provenance"
    fi

    # --no-git-checks: CI checks out a detached HEAD, which breaks pnpm's
    # publish-branch validation; we verify the working tree is clean ourselves
    # instead, so that branch check is redundant.
    if [ -n "$(git status --porcelain)" ]; then
        echo "Error: Git working tree is not clean. Aborting publish."
        git status --short
        exit 1
    fi

    pnpm publish --access public --no-git-checks $provenance "$@"
}
