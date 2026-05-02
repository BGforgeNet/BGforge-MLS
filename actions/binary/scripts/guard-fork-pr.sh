#!/bin/bash
# Block fork pull_request invocations: their GITHUB_TOKEN is read-only and the
# eventual `git push` would fail with a confusing "permission denied" error.
# Inputs (env): EVENT_NAME, IS_FORK
set -euo pipefail

if [[ "$EVENT_NAME" == "pull_request" && "$IS_FORK" == "true" ]]; then
    echo "::error::actions/binary cannot push to fork PR branches (read-only GITHUB_TOKEN)."
    exit 1
fi
