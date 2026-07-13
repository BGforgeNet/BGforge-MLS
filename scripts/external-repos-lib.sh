#!/bin/bash

# Shared logic for cloning the external repos used as test fixtures.
# Source this file; do not execute it directly.
#
# Each line in external/*.txt is either:
#   - blank or a # comment -> ignored
#   - "<url>"              -> cloned shallow (--depth 1) at the upstream HEAD
#   - "<url> <commit_sha>" -> fetched shallow at the specific commit (pinned)
#
# Pinned commits make the integration tests reproducible across upstream
# pushes; unpinned URLs follow upstream HEAD.

# Clone each repo listed in $1 into $2.
# If a target directory already exists, leave its checkout alone - callers
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

# Clone IESDP into $1 if missing, then check out the latest remote ielib branch.
# Shared by ie-update.sh (BAF actions/triggers data) and ie-binary-update.sh
# (binary format specs), which both source the data off the ielib branch.
checkout_iesdp_ielib() {
    local iesdp_dir="$1"
    local iesdp_repo="https://github.com/BGforgeNet/iesdp.git"

    mkdir -p "$(dirname "$iesdp_dir")"
    if [ ! -d "$iesdp_dir" ]; then
        git clone "$iesdp_repo" "$iesdp_dir"
    fi
    # Works whether the local repo came from `git clone` (full history, branches
    # tracked) or from clone_repos' `git init + git fetch <SHA>` (shallow, detached
    # HEAD, no local branches). Both cases land on the latest remote ielib. Use
    # `git -C` (like clone_repos) instead of cd/pushd so the lib needs no `set -e`
    # guard against a failed cd.
    git -C "$iesdp_dir" fetch --depth 1 origin ielib
    git -C "$iesdp_dir" checkout -B ielib FETCH_HEAD
}
