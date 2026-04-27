#!/bin/bash

# Shared logic for cloning the external repos used as test fixtures.
#
# Each line in external/*.txt is either:
#   - blank or a # comment → ignored
#   - "<url>"              → cloned shallow (--depth 1) at the upstream HEAD
#   - "<url> <commit_sha>" → fetched shallow at the specific commit (pinned)
#
# Pinned commits make the integration tests reproducible across upstream
# pushes; unpinned URLs follow upstream HEAD.

# Clone each repo listed in $1 into $2.
# If a target directory already exists, leave its checkout alone — callers
# rely on this for the "already cloned" optimisation.
clone_repos() {
    local txt_file="$1"
    local target_dir="$2"

    mkdir -p "$target_dir"
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ -z "$line" || "$line" == \#* ]] && continue
        local url commit name
        url=$(awk '{print $1}' <<<"$line")
        commit=$(awk '{print $2}' <<<"$line")
        name=$(basename "$url" .git)

        if [[ -d "$target_dir/$name" ]]; then
            echo "  Already cloned: $name"
            continue
        fi

        if [[ -n "$commit" ]]; then
            echo "  Cloning: $name @ ${commit:0:12}"
            git init -q "$target_dir/$name"
            git -C "$target_dir/$name" remote add origin "$url"
            git -C "$target_dir/$name" fetch --depth 1 -q origin "$commit"
            git -C "$target_dir/$name" -c advice.detachedHead=false checkout -q FETCH_HEAD
        else
            echo "  Cloning: $name (HEAD)"
            git clone --depth 1 -q "$url" "$target_dir/$name"
        fi
    done <"$txt_file"
}
