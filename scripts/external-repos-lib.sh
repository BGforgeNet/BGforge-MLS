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

# Put $3 on commit $2 of $1, shallow and detached, creating the checkout when it is
# missing. An existing checkout already on the commit is left alone; one on any other
# commit is moved, because bumping a pin has to move the local tree or the consumer keeps
# reading the old content and reports on it as if it were the pinned one.
checkout_pinned_repo() {
    local url="$1"
    local commit="$2"
    local repo_dir="$3"
    local name
    name=$(basename "$repo_dir")

    if [[ ! -d "$repo_dir" ]]; then
        echo "  Cloning: $name @ ${commit:0:12}"
        git init -q "$repo_dir"
        git -C "$repo_dir" remote add origin "$url"
    elif [[ "$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)" == "$commit" ]]; then
        echo "  Already cloned: $name"
        return 0
    else
        echo "  Repinning: $name @ ${commit:0:12}"
    fi

    git -C "$repo_dir" fetch --depth 1 -q origin "$commit"
    # --force: these checkouts are disposable fixtures that consumers are free to dirty,
    # and reset-external.sh discards local edits in them anyway.
    git -C "$repo_dir" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
}

# Clone each repo listed in $1 into $2.
# Submodules are initialised on every path so pre-existing checkouts converge with fresh
# ones.
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

        if [[ -n "$commit" ]]; then
            checkout_pinned_repo "$url" "$commit" "$target_dir/$name"
        elif [[ -d "$target_dir/$name" ]]; then
            echo "  Already cloned: $name"
        else
            echo "  Cloning: $name (HEAD)"
            git clone --depth 1 -q "$url" "$target_dir/$name"
        fi
        init_submodules "$target_dir/$name"
    done <"$txt_file"
}

# Install the dependencies of repo $1 when it declares some and has none installed. The transpilers
# resolve a mod's library imports (folib, iets) from its own node_modules.
# --ignore-workspace prevents pnpm from resolving to the parent monorepo workspace, but pnpm still
# takes the monorepo's lockfile unless --lockfile-dir says otherwise, and counts a nested package (the
# IElib submodule) as a project unless --workspace-packages narrows it; either way a frozen install then
# fails for want of an importer entry. --pm-on-fail=ignore stops it recording the monorepo's
# packageManager pin into the repo's lockfile. --ignore-scripts skips lifecycle scripts: pnpm errors on
# unapproved builds (ERR_PNPM_IGNORED_BUILDS), and the workspace's allowBuilds list is detached by
# --ignore-workspace. The transpilers only read installed sources for type resolution (folib / iets
# .d.ts); no postinstall artefacts are needed.
install_repo_deps() {
    local dir="$1"
    if [[ -f "$dir/package.json" && ! -d "$dir/node_modules" ]]; then
        echo "Installing dependencies for $(basename "$dir")..."
        (cd "$dir" && pnpm install --ignore-workspace --lockfile-dir . --workspace-packages . --pm-on-fail=ignore \
            --ignore-scripts)
    fi
}

# Write the .ssl each tracked .tssl in repo $1 compiles to, beside it, as the mod's own build does, with
# the tssl CLI at $2. Such a mod ignores those files as build output, so a checkout has none, and the SSL
# corpus sweeps compile them. --no-typecheck: type errors are the transpile gate's to report.
generate_tssl_ssl() {
    local dir="$1"
    local cli="$2"
    [[ -z "$(git -C "$dir" ls-files '*.tssl')" ]] && return 0
    install_repo_deps "$dir"
    node --no-warnings "$cli" "$dir" -r --ssl --no-int --no-typecheck -q
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
