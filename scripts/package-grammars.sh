#!/bin/bash

# Package the generated tree-sitter grammar sources for consumption outside this repo.
#
# The grammars' src/ directories are generated and gitignored (.gitignore: grammars/*/src/*),
# so a clone carries grammar.js but no parser.c. Editors that build a grammar from a git ref
# (nvim-treesitter, Helix, Emacs treesit, Zed) therefore cannot use the repo directly - this
# archive is what they consume instead. Layout is one self-contained directory per grammar, so
# a consumer points its local-path recipe at <extracted>/<grammar>.

set -eu -o pipefail

cd "$(dirname "$0")/.."

version=${ARTIFACT_VERSION:-$(node -p "require('./package.json').version")}
name="bgforge-mls-tree-sitter-grammars"
stage="${name}"
# Deliberately UNVERSIONED, unlike the sibling editor bundles: GitHub's
# releases/latest/download/<name> and releases/download/<tag>/<name> both require an exact
# filename, so a versioned one cannot be fetched from a stable URL. These recipes are
# copy-pasted URLs in docs/editors/, where the editor bundles are downloaded by hand from a
# release page. The version lives in the archive's README instead.
zip_path="dist/${name}.zip"

mkdir -p dist
rm -rf "$stage" "$zip_path"

# The ABI the generated parsers target. A consumer's tree-sitter runtime must support it, and
# it is the one number that decides whether these artifacts load at all - so it is read from a
# generated parser rather than restated here.
abi=$(sed -n 's/^#define LANGUAGE_VERSION \([0-9]*\)$/\1/p' grammars/fallout-ssl/src/parser.c)
# `tree-sitter --version` prints "tree-sitter X.Y.Z"; keep only the number so the README does not
# read "tree-sitter CLI tree-sitter 0.26.9".
cli_version=$(pnpm exec tree-sitter --version | awk '{print $NF}')

if [ -z "$abi" ]; then
    echo "package-grammars: no LANGUAGE_VERSION in grammars/fallout-ssl/src/parser.c" >&2
    exit 1
fi

packaged=()
for dir in grammars/*/; do
    [ -f "${dir}grammar.js" ] || continue
    grammar=$(basename "$dir")

    # Generated sources are the whole point of the archive; without them the extracted
    # directory looks usable and fails at compile time in the consumer's editor.
    if [ ! -f "${dir}src/parser.c" ]; then
        echo "package-grammars: ${dir}src/parser.c missing - run pnpm build:grammar first" >&2
        exit 1
    fi

    out="${stage}/${grammar}"
    mkdir -p "$out/src"
    cp "${dir}grammar.js" "${dir}tree-sitter.json" "${dir}package.json" "$out/"
    cp -r "${dir}src/tree_sitter" "$out/src/"
    cp "${dir}src/parser.c" "${dir}src/grammar.json" "${dir}src/node-types.json" "$out/src/"
    # Hand-written external scanner, present for three of the six grammars.
    [ -f "${dir}src/scanner.c" ] && cp "${dir}src/scanner.c" "$out/src/"
    cp -r "${dir}queries" "$out/"
    # The WASM build serves web-tree-sitter consumers; native editors ignore it.
    cp "${dir}"*.wasm "$out/" 2>/dev/null || true

    packaged+=("$grammar")
done

if [ ${#packaged[@]} -eq 0 ]; then
    echo "package-grammars: no grammars found under grammars/" >&2
    exit 1
fi

# Helix and Zed name several captures differently and style a different subset, so shipping only the
# canonical (Neovim-convention) file leaves tokens unstyled in both. See scripts/utils/src/editor-captures.ts.
pnpm exec tsx scripts/utils/src/generate-editor-queries.ts --bundle-dir "$stage"

{
    echo "# BGforge MLS tree-sitter grammars ${version}"
    echo
    echo "Generated parsers, queries, and WASM builds for the grammars in this bundle:"
    echo
    for grammar in "${packaged[@]}"; do
        echo "- \`${grammar}/\`"
    done
    echo
    echo "Built with tree-sitter CLI ${cli_version}, parser ABI ${abi}. Your editor's tree-sitter"
    echo "runtime must support that ABI; an older runtime refuses to load these parsers."
    echo
    echo "Each directory is self-contained: \`grammar.js\`, the generated \`src/\` (\`parser.c\`,"
    echo "\`grammar.json\`, \`node-types.json\`, headers, and an external \`scanner.c\` where the"
    echo "grammar has one), \`queries/highlights.scm\`, and the \`.wasm\` build."
    echo
    echo "\`queries/highlights.scm\` uses Neovim capture conventions. Helix and Zed name several"
    echo "captures differently and style a different subset, so use \`queries/helix/highlights.scm\`"
    echo "or \`queries/zed/highlights.scm\` in those editors - the canonical file leaves tokens"
    echo "unstyled in both."
    echo
    echo "Point your editor's local-path grammar recipe at the directory you want. Per-editor"
    echo "instructions: https://github.com/BGforgeNet/BGforge-MLS/tree/master/docs/editors"
} >"${stage}/README.md"

zip -rq "$zip_path" "$stage"
rm -rf "$stage"
echo "Created $zip_path (${#packaged[@]} grammars, ABI ${abi})"
