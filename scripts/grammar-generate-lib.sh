#!/bin/bash

# Cached wrapper around `tree-sitter generate`.
# Source this file; do not execute it directly.
#
# generate's only inputs are grammar.js (self-contained in every grammar here -
# no local require()s), tree-sitter.json, and the CLI version; its outputs live
# in the gitignored src/. A content hash of the inputs therefore decides whether
# regeneration can be skipped. This matters because LR-table construction is
# expensive for large grammars (weidu-tp2 alone takes ~80s) and was previously
# paid on every grammar test and grammar build regardless of changes.

# Usage: generate_grammar_cached <grammar-dir> <tree-sitter-bin>
generate_grammar_cached() {
    local grammar_dir="$1" ts_bin="$2"
    local stamp="$grammar_dir/src/.generate-stamp"
    local hash
    hash=$(cat <("$ts_bin" --version) "$grammar_dir/grammar.js" "$grammar_dir/tree-sitter.json" | sha256sum | cut -d' ' -f1)
    if [[ -f "$stamp" && -f "$grammar_dir/src/parser.c" && "$(cat "$stamp")" == "$hash" ]]; then
        echo "generate: cached (inputs unchanged; rm src/.generate-stamp to force)"
        return 0
    fi
    (cd "$grammar_dir" && "$ts_bin" generate)
    echo "$hash" >"$stamp"
}
