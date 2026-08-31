#!/bin/bash

# Cached wrappers around `tree-sitter generate` and `tree-sitter build --wasm`.
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

# Cached wrapper around `tree-sitter build --wasm`.
#
# The compile reads the generated C in src/ - parser.c, the optional scanner.c, and the tree_sitter
# headers - plus tree-sitter.json, which names the output; nothing else reaches it. It is deterministic
# given those, so a content hash of them decides whether it can be skipped. Worth caching because the
# compile is several seconds per grammar and ran on every build even where `generate` was already a
# cache hit - about 50s of a full build for no work.
#
# Hashing content rather than comparing mtimes also fixes what the mtime form could not see: a
# scanner.c-only edit leaves parser.c untouched, so "wasm newer than parser.c" reported a hit and the
# caller went on to test against a stale parser.
#
# Usage: build_grammar_wasm_cached <grammar-dir> <tree-sitter-bin>
build_grammar_wasm_cached() {
    local grammar_dir="$1" ts_bin="$2"
    local stamp="$grammar_dir/src/.wasm-stamp"
    local inputs=("$grammar_dir/tree-sitter.json" "$grammar_dir/src/parser.c")
    if [[ -f "$grammar_dir/src/scanner.c" ]]; then
        inputs+=("$grammar_dir/src/scanner.c")
    fi
    local header
    for header in "$grammar_dir"/src/tree_sitter/*.h; do
        if [[ -f "$header" ]]; then
            inputs+=("$header")
        fi
    done

    local hash existing
    hash=$(cat <("$ts_bin" --version) "${inputs[@]}" | sha256sum | cut -d' ' -f1)
    existing=$(find "$grammar_dir" -maxdepth 1 -name '*.wasm' -print -quit)
    if [[ -f "$stamp" && -n "$existing" && "$(cat "$stamp")" == "$hash" ]]; then
        echo "build --wasm: cached (inputs unchanged; rm src/.wasm-stamp to force)"
        return 0
    fi
    (cd "$grammar_dir" && "$ts_bin" build --wasm)
    echo "$hash" >"$stamp"
}
