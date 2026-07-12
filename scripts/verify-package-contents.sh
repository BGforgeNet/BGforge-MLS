#!/bin/bash

# Fail-closed backstop for the .vscodeignore denylist, which ships anything new in the
# working tree by default (see the .vscodeignore header). Green tests never open the
# produced VSIX, so this inspects the real artifact after packaging and fails loud if an
# unexpected top-level entry, a source/test file, or a size regression sneaked in - the
# exact class that let ~34MB of gitignored-but-not-vscodeignored dev tooling ship.
set -eu -o pipefail

vsix="${1:?usage: verify-package-contents.sh <vsix>}"
if [[ ! -f "$vsix" ]]; then
    echo "verify-package-contents: no such file: $vsix" >&2
    exit 1
fi

# Size budget: the clean extension is ~9 MiB; a leaked tool cache or src/ tree balloons it.
max_bytes=$((13 * 1024 * 1024))
size=$(stat -c%s "$vsix")

# Packaged paths, with the vsix's extension/ prefix stripped. vsce control files
# ([Content_Types].xml, extension.vsixmanifest) sit outside extension/ and are skipped.
mapfile -t paths < <(unzip -Z1 "$vsix" | sed -n 's#^extension/##p')

# Every depth-1 entry must be a known runtime path. A newly added top-level dir/file that
# no one remembered to exclude fails here instead of shipping silently.
allowed_top='^(package\.json|readme\.md|README\.md|LICENSE\.(txt|md)|SECURITY\.md|CHANGELOG\.md|client|server|node_modules|syntaxes|themes|language-configurations|snippets|resources)$'

violations=()
for p in "${paths[@]}"; do
    top="${p%%/*}"
    [[ "$top" =~ $allowed_top ]] || violations+=("unexpected top-level: $p")
    # Bundled output only - a shipped source or test file means a src/ or test dir leaked.
    case "$p" in
        *.d.ts) ;;
        *.svelte | *.mts | *.ts) violations+=("source file: $p") ;;
        */test/* | *.test.*) violations+=("test file: $p") ;;
    esac
done

mib=$((size / 1024 / 1024))
if ((size > max_bytes)) || ((${#violations[@]} > 0)); then
    echo "verify-package-contents: $vsix FAILED (${mib} MiB, ${#violations[@]} content issues)" >&2
    ((size > max_bytes)) && echo "  size ${mib} MiB exceeds the $((max_bytes / 1024 / 1024)) MiB budget" >&2
    printf '  %s\n' "${violations[@]}" >&2
    exit 1
fi

echo "verify-package-contents: $vsix OK (${mib} MiB, ${#paths[@]} files)"
