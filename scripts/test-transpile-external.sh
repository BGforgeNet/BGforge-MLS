#!/bin/bash

# E2E transpiler test: transpile .td/.tbaf/.tssl from external repos,
# write output, verify git status is clean (no changes to committed .d/.baf/.ssl).
# Uses directory mode (-r --save) for batch processing in a single node process.
# Repos are tested in parallel since they are independent.

set -eu -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.fgtp));" "$ROOT_DIR/transpilers/package.json")"
TSSL_CLI="$(node -e "const path=require('node:path'); const pkgPath=process.argv[1]; const pkg=require(pkgPath); process.stdout.write(path.resolve(path.dirname(pkgPath), pkg.bin.tssl));" "$ROOT_DIR/compilers/tssl/package.json")"

# shellcheck source=scripts/timing-lib.sh
source "$SCRIPT_DIR/timing-lib.sh"

LOG_DIR="$ROOT_DIR/tmp/transpile-external-logs"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# shellcheck source=scripts/parallel-lib.sh
source "$SCRIPT_DIR/parallel-lib.sh"

# Build CLIs if missing
if [[ ! -f "$CLI" ]]; then
    step "Building transpile CLI"
    (cd "$ROOT_DIR" && pnpm build:transpile)
fi
if [[ ! -f "$TSSL_CLI" ]]; then
    step "Building tssl CLI"
    (cd "$ROOT_DIR" && pnpm build:tssl)
fi

# Transpile all files in a repo, then check git status for changes.
# Exits non-zero on failure so parallel runner can detect it.
# $1: repo directory
test_repo() {
    local dir="$1"
    local repo
    repo=$(basename "$dir")

    if [[ ! -d "$dir" ]]; then
        echo "SKIP: $repo (not cloned)"
        return 0
    fi

    # Reset to committed state before testing
    git -C "$dir" checkout .

    # Install dependencies if node_modules is missing.
    # --ignore-workspace prevents pnpm from resolving to the parent monorepo workspace.
    # --ignore-scripts skips lifecycle scripts: pnpm 11 errors on unapproved builds
    # (ERR_PNPM_IGNORED_BUILDS), and the workspace's allowBuilds list is detached by
    # --ignore-workspace. The transpile CLI only reads installed sources for type
    # resolution (folib / iets .d.ts); no postinstall artefacts are needed.
    if [[ -f "$dir/package.json" && ! -d "$dir/node_modules" ]]; then
        echo "Installing dependencies for $repo..."
        (cd "$dir" && pnpm install --ignore-workspace --ignore-scripts)
    fi

    # One process per language family, and only where that family has sources. `.tssl` belongs to the
    # tssl compiler, which emits bytecode by default - `--transpile` is what asks it for the .ssl this
    # gate compares. `fgtp` covers the rest.
    if [[ -n "$(git -C "$dir" ls-files '*.td' '*.tbaf')" ]]; then
        if ! node --no-warnings "$CLI" "$dir" -r --save 2>&1; then
            echo "FAIL: $repo (transpilation errors)"
            return 1
        fi
    fi
    if [[ -n "$(git -C "$dir" ls-files '*.tssl')" ]]; then
        if ! node --no-warnings "$TSSL_CLI" "$dir" -r --transpile 2>&1; then
            echo "FAIL: $repo (tssl compilation errors)"
            return 1
        fi
    fi

    # .baf and .d outputs must match the committed files byte for byte - their pipelines promise it.
    local changed
    changed=$(git -C "$dir" diff --name-only -- ':!*.ssl')
    if [[ -n "$changed" ]]; then
        echo "FAIL: $repo (output differs from committed files)"
        git -C "$dir" diff --stat -- ':!*.ssl'
        return 1
    fi

    # Generated .ssl text is allowed to drift (spacing, literal spelling, comments); what ships is the
    # compiled script, so the gate is bytecode equivalence against the committed version at every level.
    # The two allow-listed files are VERIFIED corrections of the committed baseline, not tolerated noise:
    #   gl_g_healing_revision.ssl - the author's 100.0 float divisors were shipped as integer 100
    #     (integer division) by the old bundler's literal normalisation; the transpiler now preserves them.
    #   gl_g_molotov.ssl - SSL's and/or share one precedence level, so the old output's stripped
    #     parentheses changed `(a && b) || (c && d)` into `((a and b) or c) and d`; the transpiler now
    #     keeps the author's grouping.
    if [[ -n "$(git -C "$dir" diff --name-only -- '*.ssl')" ]]; then
        if ! (cd "$ROOT_DIR" && pnpm --silent ssl-equiv "$dir" \
            --allow gl_g_healing_revision.ssl --allow gl_g_molotov.ssl); then
            echo "FAIL: $repo (generated .ssl no longer compiles to the committed bytecode)"
            return 1
        fi
        # Other suites read these trees (the SSL corpus differential compiles the .ssl files), so the
        # equivalence-checked drift is put back rather than left for them to sweep.
        git -C "$dir" checkout -- '*.ssl'
    fi

    # The bytecode oracle measures the same property as ssl-equiv above - the transpiler still produces
    # something that compiles to the bytes it used to - without needing a committed .ssl to compare
    # against, so it is what remains once a mod stops shipping the intermediate. Both run while both can:
    # ssl-equiv covers the text as committed, this covers the bytecode at four switch sets including the
    # `-s` the mods actually ship, which no other sweep exercises on a real script.
    if [[ -n "$(git -C "$dir" ls-files '*.tssl')" ]]; then
        if ! (cd "$ROOT_DIR" && pnpm --silent tssl-oracles "$dir"); then
            echo "FAIL: $repo (transpiled bytecode differs from the committed oracles)"
            return 1
        fi
        # The two routes to bytecode must agree: through generated SSL text, and straight to the IR.
        # This is what makes an emitted .ssl a guarantee rather than a hope - it is not merely offered
        # alongside the .int, it is checked to compile to the same bytes, at every switch set the mods
        # use. Enforced rather than advisory now that the direct route covers the whole repo.
        # One invocation covering every switch set: transpiling and lowering are the expensive half and
        # are done once, where a run per set repeated them and cost four times as long.
        if ! (cd "$ROOT_DIR" && pnpm --silent tssl-int-diff "$dir" -O0 -- -O1 -- -O2 -- -O2 -s); then
            echo "FAIL: $repo (direct-to-IR compilation differs from the text route)"
            return 1
        fi
    fi

    echo "PASS: $repo"
}

step "Transpile external repos"
parallel \
    "bg2-tweaks-and-tricks" "test_repo '$ROOT_DIR/external/infinity-engine/bg2-tweaks-and-tricks'" \
    "bg2-wildmage" "test_repo '$ROOT_DIR/external/infinity-engine/bg2-wildmage'" \
    "FO2tweaks" "test_repo '$ROOT_DIR/external/fallout/FO2tweaks'"

timing_summary "Transpile external tests passed"
