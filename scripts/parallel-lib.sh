#!/bin/bash

# Parallel job runner for test scripts.
# Source this file; do not execute it directly.
# Each job's output goes to a log file - silent on success, full output on failure.
#
# Usage: parallel "label1" "cmd1" "label2" "cmd2" ...
#
# Requires LOG_DIR to be set before calling.

# Advisory lines that build and lint tools print on a run they still exit 0 from - a deprecation, a
# default the tool plans to adopt, a hint that some config now wants stating. Nothing fails on these,
# and "silent on success" above meant nothing showed them either, so four of them accumulated unread
# across one dependency sweep (docs/dependencies.md records which). Anchored where the tool anchors
# them, so prose that merely contains "warning" - a test name, an assertion message - does not match;
# validated against a corpus where 169 such lines produced no hits.
# Not `readonly`: this file is sourced, and re-sourcing would then abort the caller under `set -e`.
WARNING_MARKERS='^\(!\)|\[PLUGIN_TIMINGS\]|^ *(npm |pnpm )?(WARN|warn) |^\(node:[0-9]+\) |Deprecation[Ww]arning|Experimental[Ww]arning|^ *[Ww]arning:|^ *Hint: consider'

# Print the advisory lines in a job's log, numbered; no output means the log is clean. Escapes are
# stripped first because rolldown colours its [PLUGIN_TIMINGS] tag, and a coloured line slips past
# every ^ anchor. The `|| true` is the no-match case, which is the normal one - grep exits 1 there and
# the caller wants the lines, not a status.
scan_warnings() {
    local logfile="$1" esc
    esc=$(printf '\033')
    sed "s/${esc}\[[0-9;]*[a-zA-Z]//g" "$logfile" | { grep -nE "$WARNING_MARKERS" || true; }
}

parallel() {
    local pids=() labels=() logs=() starts=() warned_labels=() warned_lines=() i=0

    while [ $# -ge 2 ]; do
        local label="$1" cmd="$2"
        shift 2
        local logfile="$LOG_DIR/${label// /-}.log"
        local start
        start=$(date +%s%3N)
        (eval "$cmd" >"$logfile" 2>&1) &
        pids+=($!)
        labels+=("$label")
        logs+=("$logfile")
        starts+=("$start")
    done

    # Wait for all, but fail fast on first failure
    while true; do
        local all_done=1
        for i in "${!pids[@]}"; do
            [ "${pids[$i]}" = "done" ] && continue
            if ! kill -0 "${pids[$i]}" 2>/dev/null; then
                if wait "${pids[$i]}"; then
                    local elapsed=$(($(date +%s%3N) - ${starts[$i]}))
                    local warns count
                    warns=$(scan_warnings "${logs[$i]}")
                    if [ -n "$warns" ]; then
                        warned_labels+=("${labels[$i]}")
                        warned_lines+=("$warns")
                        count=$(printf '%s\n' "$warns" | wc -l)
                        echo "  ok  ${labels[$i]} (${elapsed}ms)  [$count warning$([ "$count" -eq 1 ] || echo s)]"
                    else
                        echo "  ok  ${labels[$i]} (${elapsed}ms)"
                    fi
                    pids[i]="done"
                else
                    local elapsed=$(($(date +%s%3N) - ${starts[$i]}))
                    echo ""
                    echo "  FAIL  ${labels[$i]} (${elapsed}ms)"
                    echo ""
                    cat "${logs[$i]}"
                    echo "  Other logs: $LOG_DIR/"
                    for j in "${!pids[@]}"; do
                        [ "${pids[$j]}" = "done" ] && continue
                        kill "${pids[$j]}" 2>/dev/null || true
                    done
                    exit 1
                fi
            else
                all_done=0
            fi
        done
        [ "$all_done" = "1" ] && break
        sleep 0.05
    done

    # Report, do not fail: an upstream advisory arrives on someone else's schedule and must not block
    # unrelated work. Making it visible is the whole point - see docs/dependencies.md (After a bump).
    if [ "${#warned_labels[@]}" -gt 0 ]; then
        echo ""
        echo "  !  ${#warned_labels[@]} job(s) passed with tool warnings - full logs in $LOG_DIR/"
        for i in "${!warned_labels[@]}"; do
            echo "     ${warned_labels[$i]}:"
            printf '%s\n' "${warned_lines[$i]}" | sed 's/^/       /'
        done
        echo ""
    fi
}
