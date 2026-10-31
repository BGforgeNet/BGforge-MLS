#!/bin/bash

# Shared timing helpers for test scripts.
# Source this to get step() which prints elapsed time between stages; do not execute it directly.

# now_ms - epoch milliseconds. GNU date gives nanoseconds with %N; BSD date (macOS) has no %N and
# prints a literal "N", so there it falls back to whole seconds scaled to milliseconds.
now_ms() {
    local ns
    ns=$(date +%s%N)
    case "$ns" in
        *N) echo $(($(date +%s) * 1000)) ;;
        *) echo $((ns / 1000000)) ;;
    esac
}

_timing_start=$(now_ms)
_timing_prev=$_timing_start

step() {
    local now
    now=$(now_ms)
    if [ "$_timing_prev" != "$_timing_start" ]; then
        echo "  ^ $((now - _timing_prev)) ms"
    fi
    _timing_prev=$now
    echo ""
    echo "=== $1 ==="
}

timing_summary() {
    local now
    now=$(now_ms)
    echo "  ^ $((now - _timing_prev)) ms"
    echo ""
    echo "=== $1 in $((now - _timing_start)) ms ==="
}
