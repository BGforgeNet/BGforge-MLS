#!/bin/bash
# Publish one @bgforge library to npm, selected by the tag that triggered the workflow.
#
# Each library versions independently and releases on its own `<lib>/vX.Y.Z` tag (see
# publish-library.yml), separate from the repo-level `vX.Y.Z` extension/server release.
#
# Inputs (env):  TAG_NAME       - github.ref_name, e.g. "binary/v0.2.0"
#                NODE_AUTH_TOKEN - npm publish token (consumed by pnpm publish)
set -euo pipefail

if [[ -z "${TAG_NAME:-}" ]]; then
    echo "::error::TAG_NAME is empty; expected a <lib>/vX.Y.Z tag." >&2
    exit 1
fi

prefix="${TAG_NAME%%/*}"   # e.g. binary
tag_version="${TAG_NAME#*/v}"  # e.g. 0.2.0

# Map the tag prefix to the package name, its package.json, and its publish script.
# The allowlist is also the validation: an unrecognized prefix aborts.
case "$prefix" in
    binary)    pkgname="@bgforge/binary";    pkgjson="binary/package.json";                script="scripts/publish-binary.sh" ;;
    format)    pkgname="@bgforge/format";    pkgjson="format/package.json";                script="scripts/publish-format.sh" ;;
    transpile) pkgname="@bgforge/transpile"; pkgjson="transpilers/package.json";              script="scripts/publish-transpile.sh" ;;
    *)
        echo "::error::unrecognized library tag prefix '$prefix' (expected binary, format, or transpile)." >&2
        exit 1
        ;;
esac

# The tag version must match the package.json version, or we would publish a version
# that disagrees with the tag that named it.
pkg_version="$(node -p "require('./$pkgjson').version")"
if [[ "$tag_version" != "$pkg_version" ]]; then
    echo "::error::tag $TAG_NAME declares version $tag_version but $pkgjson is $pkg_version." >&2
    exit 1
fi

echo "Publishing $pkgname@$pkg_version (tag $TAG_NAME)"

# Run the package's own test script as a pre-publish gate. binary and format carry
# vitest suites; transpile's behavioural coverage lives in the repo-level sample
# tests, so its package `test` script is a no-op here.
pnpm --filter "$pkgname" test

# The publish-<pkg>.sh script builds the package and runs `pnpm publish` (adding
# --provenance under GitHub Actions). It also refuses a dirty working tree.
"./$script"
