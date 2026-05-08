#!/bin/bash

# Parallel job runner for test scripts.
# Each job's output goes to a log file - silent on success, full output on failure.
#
# Usage: parallel "label1" "cmd1" "label2" "cmd2" ...
#
# Requires LOG_DIR to be set before calling.

parallel() {
    local pids=() labels=() logs=() starts=() i=0

    while [ $# -ge 2 ]; do
        local label="$1" cmd="$2"
        shift 2
        local logfile="$LOG_DIR/${label// /-}.log"
        local start
        start=$(date +%s%3N)
        ( eval "$cmd" > "$logfile" 2>&1 ) &
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
                    local elapsed=$(( $(date +%s%3N) - ${starts[$i]} ))
                    echo "  ok  ${labels[$i]} (${elapsed}ms)"
                    pids[i]="done"
                else
                    local elapsed=$(( $(date +%s%3N) - ${starts[$i]} ))
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
}
