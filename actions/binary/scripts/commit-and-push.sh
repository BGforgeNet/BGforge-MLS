#!/bin/bash
# Stage refreshed snapshot files, commit them under the configured author,
# rebase against the latest remote tip, and push. No-op when nothing changed.
#
# Inputs (env):  COMMIT_MESSAGE, COMMIT_AUTHOR_NAME, COMMIT_AUTHOR_EMAIL,
#                EXTENSIONS (csv list of binary extensions, sourced from the
#                preceding list-changed step's `extensions` output).
# Outputs (env): GITHUB_OUTPUT receives `changed=<bool>` and `changed-files=<list>`
set -euo pipefail

git config user.name "$COMMIT_AUTHOR_NAME"
git config user.email "$COMMIT_AUTHOR_EMAIL"

# Build a `*.<ext>.json` find clause from the canonical extension list so the
# staging step covers the same formats the CLI just refreshed.
if [[ -z "${EXTENSIONS:-}" ]]; then
    echo "EXTENSIONS env var is empty; expected csv from list-changed step." >&2
    exit 1
fi
IFS=',' read -r -a exts <<<"$EXTENSIONS"
find_names=()
for ext in "${exts[@]}"; do
    [[ -z "$ext" ]] && continue
    [[ "${#find_names[@]}" -gt 0 ]] && find_names+=(-o)
    find_names+=(-name "*.${ext}.json")
done

# Stage only snapshot files; never sweep up unrelated working-tree changes.
find . -type f \( "${find_names[@]}" \) -print0 \
    | xargs -0 -r git add --

if git diff --cached --quiet; then
    {
        echo "changed=false"
        echo "changed-files="
    } >> "$GITHUB_OUTPUT"
    echo "No snapshot changes to commit."
    exit 0
fi

files="$(git diff --cached --name-only)"
{
    echo "changed=true"
    echo "changed-files<<__END__"
    echo "$files"
    echo "__END__"
} >> "$GITHUB_OUTPUT"

git commit -m "$COMMIT_MESSAGE"
git pull --rebase --autostash
git push
