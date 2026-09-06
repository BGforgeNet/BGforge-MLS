#!/usr/bin/env bash
# Coverage for the packages a change touched, so a threshold breach is found in seconds
# rather than at the end of test:all.
#
# The coverage/mutation floors live only in test:all, so without this the only way to learn
# a percentage is a full-gate run - and closing a 0.02% miss then costs another one. Each
# package's own vitest config carries its thresholds, so running it here enforces exactly
# what the gate will enforce.
#
# Usage: pnpm test:cov animation client        # named packages
#        pnpm test:cov                         # every package that has a config
set -euo pipefail

cd "$(dirname "$0")/.."

# The config extension differs per package (.ts vs .mts), so resolve rather than assume.
config_for() {
    for ext in ts mts; do
        if [ -f "$1/vitest.config.$ext" ]; then
            printf '%s/vitest.config.%s\n' "$1" "$ext"
            return 0
        fi
    done
    return 1
}

if [ "$#" -gt 0 ]; then
    packages=("$@")
else
    packages=()
    for config in */vitest.config.ts */vitest.config.mts; do
        [ -e "$config" ] || continue
        packages+=("$(dirname "$config")")
    done
fi

failed=()
for package in "${packages[@]}"; do
    if ! config=$(config_for "$package"); then
        echo "no vitest config for '$package'" >&2
        exit 2
    fi
    echo "=== coverage $package ==="
    # Not `&&`-chained into the tally: a threshold breach must not stop the other packages,
    # since knowing every breach at once is the whole point of running this before the gate.
    if ! pnpm exec vitest run --config "$config" --coverage; then
        failed+=("$package")
    fi
done

if [ "${#failed[@]}" -gt 0 ]; then
    echo "coverage below threshold: ${failed[*]}" >&2
    exit 1
fi
echo "coverage: all thresholds met (${packages[*]})"
