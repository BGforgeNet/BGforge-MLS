#!/bin/bash

# Gate for the packaged grammar bundle: extract it somewhere clean and build every grammar the
# way a consuming editor does - cc over the generated src/ - then confirm each shared object
# exports its tree_sitter_<language> entrypoint.
#
# The unit suites parse through WASM and never open this archive, so nothing else catches a
# bundle that ships an incomplete src/ (a missing header, an external scanner left behind). The
# failure mode it guards is silent for us and fatal for the consumer: the extracted directory
# looks right and only fails in their editor.

set -eu -o pipefail

cd "$(dirname "$0")/.."

zip_path=${1:-dist/bgforge-mls-tree-sitter-grammars.zip}

if [ -z "$zip_path" ] || [ ! -f "$zip_path" ]; then
    echo "verify-grammar-bundle: no bundle found - run scripts/package-grammars.sh first" >&2
    exit 1
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

unzip -q "$zip_path" -d "$work"
root="$work/bgforge-mls-tree-sitter-grammars"

if [ ! -d "$root" ]; then
    echo "verify-grammar-bundle: $zip_path has no bgforge-mls-tree-sitter-grammars/ root" >&2
    exit 1
fi

checked=0
for dir in "$root"/*/; do
    grammar=$(basename "$dir")
    [ -d "${dir}src" ] || continue

    sources=("${dir}src/parser.c")
    [ -f "${dir}src/scanner.c" ] && sources+=("${dir}src/scanner.c")

    # -Wl,--no-undefined is load-bearing, not hardening: a shared object links happily with
    # unresolved symbols, so a bundle that drops an external scanner.c still builds here and
    # fails only when the editor dlopen()s it. Verified by removing a scanner - without this
    # flag the gate passes.
    if ! cc -shared -fPIC -Wl,--no-undefined -I "${dir}src" -o "${dir}grammar.so" "${sources[@]}"; then
        echo "verify-grammar-bundle: $grammar does not compile from the bundled sources" >&2
        exit 1
    fi

    # The entrypoint name is what an editor resolves by; a parser that compiles but exports
    # nothing loadable is the same failure one step later.
    if ! nm -D --defined-only "${dir}grammar.so" | grep -q 'tree_sitter_[A-Za-z_]*'; then
        echo "verify-grammar-bundle: $grammar exports no tree_sitter_<language> entrypoint" >&2
        exit 1
    fi

    if [ ! -s "${dir}queries/highlights.scm" ]; then
        echo "verify-grammar-bundle: $grammar has no highlight queries" >&2
        exit 1
    fi

    checked=$((checked + 1))
done

if [ "$checked" -eq 0 ]; then
    echo "verify-grammar-bundle: $zip_path contains no grammars" >&2
    exit 1
fi

echo "verify-grammar-bundle: $checked grammars compile and export an entrypoint ($zip_path)"
