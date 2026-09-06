#!/bin/bash

set -xeu -o pipefail

yaml2json="pnpm exec tsx scripts/utils/src/yaml2json.ts"
syntaxes_dir="syntaxes"
# Defaults to writing beside the sources; a guard test passes a temp dir and diffs the
# result against the tracked JSON.
out_dir="${1:-$syntaxes_dir}"
error_file="tmp/$(basename "$0").err"

function convert() {
    yaml_file="$1"
    # shellcheck disable=SC2001
    json_file="$out_dir/$(basename "$yaml_file" | sed 's|\.yml$|.json|i')"
    $yaml2json "$yaml_file" "$json_file"
}

mkdir -p tmp "$out_dir"
rm -f "$error_file"
for yaml_file in "$syntaxes_dir"/*.yml; do
    convert "$yaml_file" || touch "$error_file" &
done

wait

if [[ -f "$error_file" ]]; then
    echo "Failed!"
    exit 1
fi
