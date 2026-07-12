#!/bin/bash

# Shared timing helpers for test scripts.
# Source this to get step() which prints elapsed time between stages.

_timing_start=$(date +%s%3N)
_timing_prev=$_timing_start

step() {
    local now
    now=$(date +%s%3N)
    if [ "$_timing_prev" != "$_timing_start" ]; then
        echo "  ^ $((now - _timing_prev)) ms"
    fi
    _timing_prev=$now
    echo ""
    echo "=== $1 ==="
}

timing_summary() {
    local now
    now=$(date +%s%3N)
    echo "  ^ $((now - _timing_prev)) ms"
    echo ""
    echo "=== $1 in $((now - _timing_start)) ms ==="
}
