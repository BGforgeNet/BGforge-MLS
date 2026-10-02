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

prefix="${TAG_NAME%%/*}"      # e.g. binary
tag_version="${TAG_NAME#*/v}" # e.g. 0.2.0

needs_grammar=""
needs_build=""

# Map the tag prefix to the package name, its package.json, and its publish script.
# The allowlist is also the validation: an unrecognized prefix aborts.
case "$prefix" in
    binary)
        pkgname="@bgforge/binary"
        pkgjson="binary/package.json"
        script="scripts/publish-binary.sh"
        testcfg="binary/vitest.config.ts"
        ;;
    format)
        pkgname="@bgforge/format"
        pkgjson="format/package.json"
        script="scripts/publish-format.sh"
        testcfg="format/vitest.config.ts"
        needs_grammar=1
        ;;
    transpile)
        pkgname="@bgforge/transpile"
        pkgjson="transpilers/package.json"
        script="scripts/publish-transpile.sh"
        testcfg="transpilers/vitest.config.ts"
        needs_build=1
        # Its grammar-acceptance tests parse the emitted BAF/D through shared/parsers.
        needs_grammar=1
        ;;
    tssl)
        pkgname="@bgforge/tssl"
        pkgjson="compilers/tssl/package.json"
        script="scripts/publish-tssl.sh"
        testcfg="compilers/tssl/vitest.config.ts"
        ;;
    ssl)
        pkgname="@bgforge/ssl"
        pkgjson="compilers/ssl/package.json"
        script="scripts/publish-ssl.sh"
        testcfg="compilers/ssl/vitest.config.ts"
        # Its suite parses SSL through the grammar WASM that build:grammar links into shared/parsers, and its
        # build copies that WASM beside the CLI.
        needs_grammar=1
        ;;
    *)
        echo "::error::unrecognized library tag prefix '$prefix' (expected binary, format, transpile, tssl, or ssl)." >&2
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

# format bundles the tree-sitter grammar WASM and its gate reads the grammar's generated
# node types; transpile's gate parses its output through the WASM that build:grammar links
# into shared/parsers. All are gitignored artifacts this lean checkout lacks, and
# publish-format.sh builds them only after the gate below, too late for the tests.
if [[ -n "$needs_grammar" ]]; then
    pnpm build:grammar
    # build:grammar also regenerates tracked grammar sources; restore them so regen drift
    # cannot leave the tree dirty and trip the clean-tree guard in publish-lib.sh.
    git checkout -- .
    export SKIP_GRAMMAR_BUILD=1
fi

# transpile's suite smoke-tests its own built bundle and bin (bundle.test.ts, cli.test.ts), so it
# builds before the gate rather than inside its publish script.
if [[ -n "$needs_build" ]]; then
    pnpm build:transpile
    export SKIP_BUILD=1
fi

# Run the package's vitest suite as a pre-publish gate FROM THE REPO ROOT. These
# suites resolve shared fixtures (client/testFixture/, external/) relative to the
# working directory, so cwd must be the repo root - the same way scripts/test.sh
# invokes them. `pnpm --filter <pkg> test` would re-root cwd into the package dir
# and break binary's fixture resolution (its fixtures live at the repo root).
pnpm exec vitest run --config "$testcfg"

# The publish-<pkg>.sh script builds the package and runs `pnpm publish` (adding
# --provenance under GitHub Actions). It also refuses a dirty working tree.
"./$script"
