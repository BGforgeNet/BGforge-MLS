#!/bin/bash

set -euo pipefail

# Shared helpers for the actions/* composite-action scripts. SOURCE this file
# (do not execute it): each action's list-changed.sh / commit-and-push.sh sources
# it via "${GITHUB_ACTION_PATH}/../_shared/lib.sh". This works because a remote
# action reference (uses: owner/repo/actions/<name>@ref) downloads the whole repo
# to _actions/owner/repo/ref/, so the sibling _shared/ dir is present alongside
# the action's own directory. The release tag must therefore include _shared/
# (see docs/releasing.md) - which it does, since tags point at whole-repo commits.

# Scan the event's changed files and emit `list=<path>` and `count=<n>` to
# GITHUB_OUTPUT. The caller supplies its own mapping logic and full-scan globs:
#   $1       - name of a shell function that filters `git diff --name-only` lines
#              into the work-list paths (each action's source<->output mapping).
#   $2..     - find -name clause tokens for the no-base-SHA full-scan fallback.
# Inputs (env): EVENT_NAME, SCAN_PATH, BASE_SHA_PR, HEAD_SHA_PR,
#               BASE_SHA_PUSH, HEAD_SHA_PUSH, GITHUB_OUTPUT.
lc_emit_list() {
    local filter_fn="$1"
    shift
    local find_names=("$@")
    local list mode base head count
    list="$(mktemp)"
    mode=full
    base=""
    head=""

    case "$EVENT_NAME" in
        pull_request)
            base="$BASE_SHA_PR"
            head="$HEAD_SHA_PR"
            ;;
        push)
            base="$BASE_SHA_PUSH"
            head="$HEAD_SHA_PUSH"
            # Zero-SHA = new branch; no usable base for diff.
            [[ "$base" =~ ^0+$ ]] && base=""
            ;;
    esac

    if [[ -n "$base" && -n "$head" ]]; then
        # Default checkouts are shallow; pull base+head into the local clone so
        # `git diff` can resolve them. Failures fall through to the full-scan.
        git fetch --no-tags --depth=1 origin "$base" "$head" >/dev/null 2>&1 || true
        if git rev-parse --verify --quiet "$base" >/dev/null &&
            git rev-parse --verify --quiet "$head" >/dev/null; then
            git diff --name-only --diff-filter=AMR "$base" "$head" -- "$SCAN_PATH" |
                "$filter_fn" |
                while IFS= read -r f; do [[ -f "$f" ]] && echo "$f"; done \
                    >"$list"
            mode=incremental
        fi
    fi

    if [[ "$mode" == "full" ]]; then
        find "$SCAN_PATH" -type f \( "${find_names[@]}" \) >"$list"
    fi

    sort -u -o "$list" "$list"
    count=$(wc -l <"$list")
    echo "Mode: $mode, files: $count"

    {
        echo "list=$list"
        echo "count=$count"
    } >>"$GITHUB_OUTPUT"
}

# Commit whatever the caller has already staged and push, rebasing onto the
# remote tip only if a concurrent push rejects ours. No-op when nothing is
# staged. Emits `changed=<bool>` and `changed-files=<list>` to GITHUB_OUTPUT.
# Inputs (env): COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL, GITHUB_OUTPUT.
finalize_commit_and_push() {
    git config user.name "$COMMIT_AUTHOR_NAME"
    git config user.email "$COMMIT_AUTHOR_EMAIL"

    if git diff --cached --quiet; then
        {
            echo "changed=false"
            echo "changed-files="
        } >>"$GITHUB_OUTPUT"
        echo "No changes to commit."
        return 0
    fi

    local files
    files="$(git diff --cached --name-only)"
    {
        echo "changed=true"
        echo "changed-files<<__END__"
        echo "$files"
        echo "__END__"
    } >>"$GITHUB_OUTPUT"

    git commit -m "$COMMIT_MESSAGE"

    # Push directly. In the common case the branch has not moved since checkout,
    # so this succeeds with no fetch. Only when a concurrent push moved the branch
    # do we rebase onto the remote and retry, avoiding the full-ref-namespace fetch
    # that an unconditional `git pull --rebase` would incur on every run.
    if ! git push; then
        git pull --rebase --autostash --no-tags
        git push
    fi
}
