#!/bin/bash

# Block fork pull_request invocations: their GITHUB_TOKEN is read-only and the
# eventual `git push` would fail with a confusing "permission denied" error.
# Shared by all actions/* composite actions (invoked from each action.yml as
# ${{ github.action_path }}/../_shared/guard-fork-pr.sh).
# Inputs (env): EVENT_NAME, IS_FORK
set -euo pipefail

if [[ ("$EVENT_NAME" == "pull_request" || "$EVENT_NAME" == "pull_request_target") && "$IS_FORK" == "true" ]]; then
    echo "::error::This action cannot push to fork PR branches (read-only GITHUB_TOKEN)."
    exit 1
fi
