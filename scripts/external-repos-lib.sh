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

# Initialise any submodules of $1 (shallow, recursive). No-op when the repo
# declares none. Some mods vendor shared libraries (e.g. BGforge-MLS-IElib) as
# submodules, and their sources are part of the real-world corpus the
# integration tests sweep.
init_submodules() {
    local repo_dir="$1"
    if [[ -f "$repo_dir/.gitmodules" ]]; then
        git -C "$repo_dir" submodule update --init --recursive --depth 1 -q
    fi
}

# Clone each repo listed in $1 into $2.
# An existing checkout is left alone unless the list pins a commit it is not
# on: bumping a pin has to move the local tree, or the tests keep reading the
# old corpus and report on it as if it were the pinned one. Submodules are
# initialised on every path so pre-existing checkouts converge with fresh ones.
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
            local head_sha=""
            if [[ -n "$commit" ]]; then
                head_sha=$(git -C "$target_dir/$name" rev-parse HEAD 2>/dev/null || true)
            fi
            if [[ -n "$commit" && "$head_sha" != "$commit" ]]; then
                echo "  Repinning: $name @ ${commit:0:12}"
                git -C "$target_dir/$name" fetch --depth 1 -q origin "$commit"
                # --force: these checkouts are disposable fixtures that tests are free to
                # dirty, and reset-external.sh discards local edits in them anyway.
                git -C "$target_dir/$name" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
            else
                echo "  Already cloned: $name"
            fi
            init_submodules "$target_dir/$name"
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
        init_submodules "$target_dir/$name"
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
