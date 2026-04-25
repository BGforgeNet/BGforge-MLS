#!/bin/bash

set -euo pipefail

# Verify that supply-chain hardening artifacts are present in the repository:
#   (a) OpenSSF Scorecard workflow exists.
#   (b) CycloneDX SBOM generation step is present in build.yml.
#   (c) SLSA provenance generator is referenced in the release pipeline.
#   (d) CodeQL workflow exists (closes the Scorecard SAST check).

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

fail=0

check() {
    local label="$1"
    local result="$2"
    if [[ "$result" == "ok" ]]; then
        echo "  PASS  $label"
    else
        echo "  FAIL  $label"
        fail=1
    fi
}

echo "Supply-chain invariant checks:"

# (a) Scorecard workflow exists
if [[ -f "$ROOT_DIR/.github/workflows/scorecard.yml" ]]; then
    check "scorecard.yml exists" "ok"
else
    check "scorecard.yml exists" "missing"
fi

# (b) CycloneDX SBOM step present in build.yml
if grep -q "cyclonedx" "$ROOT_DIR/.github/workflows/build.yml"; then
    check "build.yml contains CycloneDX SBOM step" "ok"
else
    check "build.yml contains CycloneDX SBOM step" "missing"
fi

# (c) SLSA provenance generator referenced (either in build.yml or release-provenance.yml)
slsa_found=0
for f in "$ROOT_DIR/.github/workflows/build.yml" "$ROOT_DIR/.github/workflows/release-provenance.yml"; do
    if [[ -f "$f" ]] && grep -q "slsa-github-generator" "$f"; then
        slsa_found=1
        break
    fi
done
if [[ "$slsa_found" -eq 1 ]]; then
    check "SLSA provenance generator referenced" "ok"
else
    check "SLSA provenance generator referenced" "missing"
fi

# (d) CodeQL workflow exists
if [[ -f "$ROOT_DIR/.github/workflows/codeql.yml" ]]; then
    check "codeql.yml exists" "ok"
else
    check "codeql.yml exists" "missing"
fi

if [[ "$fail" -ne 0 ]]; then
    echo ""
    echo "One or more supply-chain checks failed."
    exit 1
fi

echo ""
echo "All supply-chain checks passed."
