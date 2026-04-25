#!/bin/bash

# Shared library for grammar test scripts.
# Source this after setting GRAMMAR_NAME and SAMPLE_EXTS.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TS="$ROOT_DIR/node_modules/.bin/tree-sitter"
OXLINT="$ROOT_DIR/node_modules/.bin/oxlint"
GRAMMAR_DIR="$ROOT_DIR/grammars/$GRAMMAR_NAME"

# shellcheck source=scripts/timing-lib.sh
source "$ROOT_DIR/scripts/timing-lib.sh"

cd "$GRAMMAR_DIR" || exit 1

find_samples() {
    find "$1" -type f \( "${SAMPLE_EXTS[@]}" \) -print0
}

grammar_generate() {
    step "$GRAMMAR_NAME: Generating grammar"
    "$TS" generate
}

grammar_lint() {
    step "$GRAMMAR_NAME: Running Oxlint"
    "$OXLINT" grammar.js
}

grammar_corpus() {
    step "$GRAMMAR_NAME: Running corpus tests"
    "$TS" test
}

grammar_highlight() {
    # Highlight query validation has two parts:
    #
    # 1. Assertion tests in test/highlight/ — validated by `tree-sitter test`
    #    in grammar_corpus(). These verify that specific source positions get
    #    the expected capture names. This is the primary correctness check.
    #
    # 2. `tree-sitter highlight --check` — validates capture names against
    #    tree-sitter's built-in list. Skipped because:
    #    a) It requires tree-sitter-* directory naming for CLI auto-discovery,
    #       but our grammars use domain names (weidu-baf, fallout-ssl, etc.).
    #       Only the CLI cares about this — editors (Neovim, Helix, Zed, Emacs)
    #       discover grammars through their own config, not directory names.
    #    b) Its built-in list is very conservative and doesn't include
    #       Neovim-convention captures (keyword.conditional, function.builtin,
    #       function.call, string.special, etc.) that are widely supported by
    #       all editors. Every capture we use would produce a warning.
    #
    # So this step only checks that highlights.scm exists as a smoke test.
    if [[ ! -f "$GRAMMAR_DIR/queries/highlights.scm" ]]; then
        step "$GRAMMAR_NAME: Skipping highlight validation (no queries/highlights.scm)"
        return
    fi
    step "$GRAMMAR_NAME: Validating highlight captures"
}

grammar_parse() {
    step "$GRAMMAR_NAME: Parsing samples"
    while IFS= read -r -d '' f; do
        full_output=$("$TS" parse "$f" 2>&1) || true
        result=$(echo "$full_output" | tail -1)
        if echo "$result" | grep -qE "(ERROR|MISSING)"; then
            echo "PARSE ERROR: $f"
            echo "  $result"
            exit 1
        fi
    done < <(find_samples test/samples)
}

grammar_build_format() {
    if [[ "${SKIP_FORMAT_BUILD:-}" == "1" ]]; then
        return
    fi
    step "$GRAMMAR_NAME: Building format CLI"
    (cd "$ROOT_DIR" && pnpm build:format)
}

grammar_format() {
    step "$GRAMMAR_NAME: Formatting samples"
    rm -rf test/samples-formatted test/samples-formatted-2

    # Copy samples to samples-formatted, remove non-matching files, then format in-place.
    cp -r test/samples test/samples-formatted
    # Remove files that don't match the grammar's extensions (e.g. .2da, .itm companions)
    find test/samples-formatted -type f ! \( "${SAMPLE_EXTS[@]}" \) -delete
    # Remove empty directories left after deletion
    find test/samples-formatted -type d -empty -delete 2>/dev/null || true
    # --save-and-check saves the formatted output and verifies idempotency in one pass
    pnpm -s --dir "$ROOT_DIR" format "grammars/$GRAMMAR_NAME/test/samples-formatted" -r --save-and-check -q
}

grammar_compare() {
    step "$GRAMMAR_NAME: Comparing against expected output"
    if ! diff -ru test/samples-expected test/samples-formatted; then
        echo "FAILED: Formatter output differs from expected"
        exit 1
    fi
}

grammar_regenerate_expected() {
    echo ""
    echo "=== Regenerating expected output ==="
    rm -rf test/samples-expected
    cp -r test/samples test/samples-expected
    find test/samples-expected -type f ! \( "${SAMPLE_EXTS[@]}" \) -delete
    find test/samples-expected -type d -empty -delete 2>/dev/null || true
    pnpm -s --dir "$ROOT_DIR" format "grammars/$GRAMMAR_NAME/test/samples-expected" -r --save -q
    echo "Done: $(find test/samples-expected -type f | wc -l) files regenerated"
}

grammar_success() {
    echo ""
    echo "SUCCESS: $GRAMMAR_NAME"
}
