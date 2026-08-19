#!/bin/bash

# Run the test suites relevant to a set of changed paths, so a local edit doesn't require the
# full pnpm test run to get feedback. Suite triggers mirror the cross-package import graph
# lefthook.yml's pre-commit typechecks encode (see its header comment) plus the close-out
# scoping guidance in AGENTS.md.
#
# Usage: scripts/test-scoped.sh [--dry-run] [--full] [paths...]
#   --dry-run  print the suite plan without running anything
#   --full     also run `pnpm test:grammars` when a grammar/syntax path is touched (slow;
#              otherwise only a notice is printed)
#
# With no paths given, the changed set is derived from git: staged, unstaged, and untracked
# files (git ls-files --others already respects .gitignore, so tmp/ and other ignored paths
# are excluded without extra filtering). Paths are treated as repository-root-relative,
# matching what git itself reports.
set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

dry_run=0
full=0
paths=()

for arg in "$@"; do
    case "$arg" in
        --dry-run) dry_run=1 ;;
        --full) full=1 ;;
        *) paths+=("$arg") ;;
    esac
done

if [ ${#paths[@]} -eq 0 ]; then
    mapfile -t paths < <(
        {
            git diff --name-only --cached
            git diff --name-only
            git ls-files --others --exclude-standard
        } | sort -u
    )
fi

if [ ${#paths[@]} -eq 0 ]; then
    echo "test-scoped.sh: no changed paths found"
    exit 0
fi

# Suite id -> config/script path used to verify the mapping hasn't gone stale, the command run
# from the repo root, and the space-separated path prefixes that trigger it.
suite_ids=(server binary binary-editor client client-unit format image ssl transpilers scripts tssl-plugin td-plugin)
declare -A suite_label=(
    [server]="server unit tests"
    [binary]="binary unit tests"
    ["binary-editor"]="binary-editor unit tests"
    [client]="client typecheck + format"
    ["client-unit"]="client unit tests"
    [format]="format unit tests"
    [image]="image unit tests"
    [ssl]="ssl unit tests + corpus canary"
    [transpilers]="transpilers unit tests"
    [scripts]="scripts unit tests"
    ["tssl-plugin"]="tssl-plugin unit tests"
    ["td-plugin"]="td-plugin unit tests"
)
declare -A suite_check=(
    [server]="server/vitest.config.ts"
    [binary]="binary/vitest.config.ts"
    ["binary-editor"]="binary-editor/vitest.config.ts"
    [client]="client/scripts/test.sh"
    ["client-unit"]="client/vitest.config.ts"
    [format]="format/vitest.config.ts"
    [image]="image/vitest.config.ts"
    [ssl]="compilers/ssl/vitest.config.ts"
    [transpilers]="transpilers/vitest.config.ts"
    [scripts]="scripts/vitest.config.ts"
    ["tssl-plugin"]="plugins/tssl-plugin/vitest.config.ts"
    ["td-plugin"]="plugins/td-plugin/vitest.config.ts"
)
declare -A suite_cmd=(
    [server]="pnpm exec vitest run --config server/vitest.config.ts"
    [binary]="pnpm exec vitest run --config binary/vitest.config.ts"
    ["binary-editor"]="pnpm exec vitest run --config binary-editor/vitest.config.ts"
    [client]="cd client && pnpm test"
    ["client-unit"]="pnpm exec vitest run --config client/vitest.config.ts"
    [format]="pnpm exec vitest run --config format/vitest.config.ts"
    [image]="pnpm exec vitest run --config image/vitest.config.ts"
    # The only suite that runs two configs: the compiler's unit tests never touch a real script, so an
    # ssl change gets the 3.5s corpus canary too - the same probe `pnpm test` runs one tier up.
    [ssl]="pnpm exec vitest run --config compilers/ssl/vitest.config.ts && pnpm exec vitest run --config compilers/ssl/vitest.integration.config.ts corpus-smoke"
    [transpilers]="pnpm exec vitest run --config transpilers/vitest.config.ts"
    [scripts]="pnpm exec vitest run --config scripts/vitest.config.ts"
    ["tssl-plugin"]="pnpm exec vitest run --config plugins/tssl-plugin/vitest.config.ts"
    ["td-plugin"]="pnpm exec vitest run --config plugins/td-plugin/vitest.config.ts"
)
declare -A suite_prefixes=(
    [server]="server/ shared/"
    [binary]="binary/ shared/"
    ["binary-editor"]="binary-editor/ binary/"
    [client]="client/ server/ shared/ binary-editor/ binary/ image/"
    ["client-unit"]="client/ server/ shared/ binary-editor/ binary/ image/"
    [format]="format/ shared/"
    [image]="image/"
    [ssl]="compilers/ssl/ shared/"
    [transpilers]="transpilers/ shared/"
    [scripts]="scripts/ shared/"
    ["tssl-plugin"]="plugins/tssl-plugin/"
    ["td-plugin"]="plugins/td-plugin/"
)
grammars_label="grammar test suite"
grammars_check="scripts/test-grammars.sh"
grammars_cmd="pnpm test:grammars"

all_docs=1
declare -A suite_trigger=()
grammar_trigger=""
unmapped_paths=()

for path in "${paths[@]}"; do
    is_doc=0
    case "$path" in
        docs/* | *.md) is_doc=1 ;;
    esac
    [ "$is_doc" = 1 ] || all_docs=0

    is_grammar=0
    case "$path" in
        grammars/* | syntaxes/*.tmLanguage.yml) is_grammar=1 ;;
    esac
    if [ "$is_grammar" = 1 ] && [ -z "$grammar_trigger" ]; then
        grammar_trigger="$path"
    fi

    matched=0
    for id in "${suite_ids[@]}"; do
        IFS=' ' read -ra prefix_arr <<<"${suite_prefixes[$id]}"
        for prefix in "${prefix_arr[@]}"; do
            case "$path" in
                "$prefix"*)
                    matched=1
                    if [ -z "${suite_trigger[$id]+x}" ]; then
                        suite_trigger[$id]="$path"
                    fi
                    ;;
            esac
        done
    done

    if [ "$matched" = 0 ] && [ "$is_doc" = 0 ] && [ "$is_grammar" = 0 ]; then
        unmapped_paths+=("$path")
    fi
done

if [ "$all_docs" = 1 ]; then
    echo "docs-only change: no test suites apply"
    exit 0
fi

if [ -n "$grammar_trigger" ]; then
    if [ "$full" = 1 ]; then
        if [ ! -f "$grammars_check" ]; then
            echo "test-scoped.sh: mapping stale, missing $grammars_check for grammar suite" >&2
            exit 1
        fi
        suite_ids+=(grammars)
        suite_label[grammars]="$grammars_label"
        suite_cmd[grammars]="$grammars_cmd"
        suite_trigger[grammars]="$grammar_trigger"
    else
        echo "notice: grammar/syntax change ($grammar_trigger) - run 'pnpm test:grammars' separately (slow), or pass --full"
    fi
fi

if [ ${#unmapped_paths[@]} -gt 0 ]; then
    echo "notice: no mapped test suite for: ${unmapped_paths[*]} - consider running 'pnpm test'"
fi

run_ids=()
for id in "${suite_ids[@]}"; do
    [ -n "${suite_trigger[$id]+x}" ] || continue
    if [ ! -f "${suite_check[$id]:-}" ] && [ "$id" != "grammars" ]; then
        echo "test-scoped.sh: mapping stale, missing ${suite_check[$id]} for suite '$id'" >&2
        exit 1
    fi
    run_ids+=("$id")
done

if [ ${#run_ids[@]} -eq 0 ]; then
    exit 0
fi

step "Plan"
for id in "${run_ids[@]}"; do
    echo "  ${suite_label[$id]} (triggered by ${suite_trigger[$id]})"
done

if [ "$dry_run" = 1 ]; then
    exit 0
fi

step "Running scoped suites"
declare -A failed_set=()
for id in "${run_ids[@]}"; do
    echo ""
    echo "--- ${suite_label[$id]} ---"
    if (eval "${suite_cmd[$id]}"); then
        echo "  ok  ${suite_label[$id]}"
    else
        echo "  FAIL  ${suite_label[$id]}"
        failed_set[$id]=1
    fi
done

echo ""
echo "=== Summary ==="
for id in "${run_ids[@]}"; do
    status="ok"
    [ -n "${failed_set[$id]+x}" ] && status="FAIL"
    echo "  $status  ${suite_label[$id]}"
done

if [ ${#failed_set[@]} -gt 0 ]; then
    timing_summary "Scoped suites failed"
    exit 1
fi

timing_summary "Scoped suites passed"
