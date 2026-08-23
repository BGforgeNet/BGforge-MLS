#!/bin/bash

# Shared publish tail for the @bgforge library packages (binary, format,
# transpile, server). Source this file; do not execute it directly.
# Each publish-<pkg>.sh does its own build, then calls
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

    # --provenance needs GitHub Actions OIDC, so a local publish cannot attest one - and pnpm blocks an
    # install whose trust level regressed, so shipping one unprovenanced would break consumers.
    local provenance="" dry_run=""
    for arg in "$@"; do
        if [ "$arg" = "--dry-run" ]; then dry_run=1; fi
    done
    if [ -n "${GITHUB_ACTIONS:-}" ]; then
        provenance="--provenance"
    elif [ -z "$dry_run" ]; then
        echo "Error: a real publish must run in GitHub Actions, which can attest provenance."
        echo "  Publishing $display from here would drop it below the trust level its earlier"
        echo "  versions carry. Push a <lib>/vX.Y.Z tag, or add --dry-run to rehearse locally."
        exit 1
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
