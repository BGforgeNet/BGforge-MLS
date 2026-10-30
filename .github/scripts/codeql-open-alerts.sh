#!/bin/bash
# Fail the CodeQL workflow while the analysed ref has open CodeQL alerts.
#
# The analyze step uploads its results and stays green whatever they contain, and pushes to master get no PR check,
# so findings would otherwise surface only in the Security tab. Reading the open alerts back, rather than counting
# results in the SARIF, honours alerts dismissed there. Runs after analyze, which waits for the upload to be processed.
#
# Inputs (env):  REPO     - owner/name, github.repository
#                REF      - the analysed ref: refs/heads/<branch>, or refs/pull/<n>/merge for a pull request
#                GH_TOKEN - a token with security-events read
set -euo pipefail

for name in REPO REF; do
    if [[ -z "${!name:-}" ]]; then
        echo "::error::${name} is empty; expected the analysed repository and ref." >&2
        exit 1
    fi
done

# `--paginate` prints one JSON array per page; jq reads them as a stream.
alerts="$(gh api --paginate "repos/${REPO}/code-scanning/alerts?tool_name=CodeQL&state=open&ref=${REF}&per_page=100" |
    jq -r '.[] | "::error file=\(.most_recent_instance.location.path),line=\(.most_recent_instance.location.start_line)::CodeQL alert #\(.number) (\(.rule.id)): \(.html_url)"')"

if [[ -n "$alerts" ]]; then
    printf '%s\n' "$alerts"
    echo "$(printf '%s\n' "$alerts" | wc -l | tr -d ' ') open CodeQL alert(s) on ${REF}; fix them or dismiss them in the Security tab." >&2
    exit 1
fi
echo "No open CodeQL alerts on ${REF}."
