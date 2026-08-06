#!/bin/bash

# Publish the packaged grammar bundle to the rolling `grammars-nightly` prerelease.
#
# The release is deleted and recreated rather than having its asset clobbered, so the tag and
# the assets always describe the same commit: GitHub does not move an existing tag when a
# release's target changes, which would leave the tag pointing at an old commit while the
# bundle tracked master. Anyone checking out the tag would then build different parsers than
# the ones attached to it.

set -euo pipefail

cd "$(dirname "$0")/../.."

TAG="grammars-nightly"

bundle="dist/bgforge-mls-tree-sitter-grammars.zip"
if [ ! -f "$bundle" ]; then
    echo "publish-nightly-grammars: no bundle in dist/ - packaging step did not run" >&2
    exit 1
fi

# --cleanup-tag removes the git tag with the release. Absent release is the first-run case,
# not an error, so only a real failure should stop us.
if gh release view "$TAG" >/dev/null 2>&1; then
    gh release delete "$TAG" --yes --cleanup-tag
fi

notes=$(
    cat <<EOF
Generated tree-sitter parsers, highlight queries and WASM builds, rebuilt from
\`${GITHUB_SHA}\` on $(date -u +%Y-%m-%d).

This is a rolling prerelease tracking the default branch: the tag is moved on every build, so
pin a versioned release instead if you need a stable reference. The archive's own README lists
the parser ABI and the tree-sitter CLI version it was generated with.

Setup instructions per editor: [docs/editors](https://github.com/BGforgeNet/BGforge-MLS/tree/master/docs/editors).
EOF
)

gh release create "$TAG" "$bundle" \
    --title "Tree-sitter grammars (nightly)" \
    --notes "$notes" \
    --prerelease \
    --target "$GITHUB_SHA"

echo "publish-nightly-grammars: published $bundle to $TAG"
