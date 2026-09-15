#!/bin/bash

# Parallel job runner for test scripts.
# Source this file; do not execute it directly.
# Each job's output goes to a log file - silent on success, full output on failure.
#
# Usage: parallel "label1" "cmd1" "label2" "cmd2" ...
#
# Requires LOG_DIR to be set before calling.
#
# At most PARALLEL_JOBS run at once, defaulting to the core count. The blocks below hand this up to
# fourteen jobs, and each is a whole test runner or bundler with its own worker pool - so unbounded
# they oversubscribe both the cores (which buys nothing: these are work-bound, as test-all.sh's own
# corpus-chain comment records) and the memory, where the cost is not slowness but a killed job.
# Lower it on a constrained machine; the phase that peaks hardest is the per-package coverage block.

# Advisory lines that build and lint tools print on a run they still exit 0 from - a deprecation, a
# default the tool plans to adopt, a hint that some config now wants stating. Nothing fails on these,
# and "silent on success" above meant nothing showed them either, so four of them accumulated unread
# across one dependency sweep. Anchored where the tool anchors
# them, so prose that merely contains "warning" - a test name, an assertion message - does not match;
# validated against a corpus where 169 such lines produced no hits.
# Not `readonly`: this file is sourced, and re-sourcing would then abort the caller under `set -e`.
WARNING_MARKERS='^\(!\)|\[PLUGIN_TIMINGS\]|^ *(npm |pnpm )?(WARN|warn) |^\(node:[0-9]+\) |Deprecation[Ww]arning|Experimental[Ww]arning|^ *[Ww]arning:|^ *Hint: consider'

# Print the advisory lines in a job's log, numbered; no output means the log is clean. Escapes are
# stripped first because rolldown colours its [PLUGIN_TIMINGS] tag, and a coloured line slips past
# every ^ anchor. The `|| true` is the no-match case, which is the normal one - grep exits 1 there and
# the caller wants the lines, not a status.
# How many jobs may run at once: PARALLEL_JOBS, else the core count, else a conservative four. A value
# that is not a positive integer is refused rather than defaulted, since silently ignoring it would run
# the whole gate at a concurrency the caller did not ask for - which is what they set it to avoid.
#
# `return`, not `exit`: the caller reads this through a command substitution, where an `exit` would end
# only that subshell and hand back an EMPTY slot count - which spins the scheduling loop forever rather
# than refusing. The caller turns the non-zero return into its own exit.
parallel_slots() {
    local slots="${PARALLEL_JOBS:-}"
    if [ -z "$slots" ]; then
        # `nproc` is coreutils and absent on a stock macOS, where it fails with a message that would
        # otherwise print once per parallel block. The fallback is the whole handling, so there is
        # nothing for a caller to do with the error - unlike the bad-value case below.
        slots=$(nproc 2>/dev/null || echo 4)
    elif ! [[ "$slots" =~ ^[1-9][0-9]*$ ]]; then
        echo "PARALLEL_JOBS must be a positive integer, got '$slots'" >&2
        return 1
    fi
    echo "$slots"
}

scan_warnings() {
    local logfile="$1" esc
    esc=$(printf '\033')
    sed "s/${esc}\[[0-9;]*[a-zA-Z]//g" "$logfile" | { grep -nE "$WARNING_MARKERS" || true; }
}

parallel() {
    local pids=() labels=() logs=() starts=() warned_labels=() warned_lines=() i=0
    local queued_labels=() queued_cmds=() next=0 running=0 slots
    slots=$(parallel_slots) || exit 1

    while [ $# -ge 2 ]; do
        queued_labels+=("$1")
        queued_cmds+=("$2")
        shift 2
    done

    # Wait for all, but fail fast on first failure. Jobs start here rather than above so a free slot is
    # filled as one finishes, which is what bounds how many run at once.
    while true; do
        while [ "$running" -lt "$slots" ] && [ "$next" -lt "${#queued_labels[@]}" ]; do
            local logfile="$LOG_DIR/${queued_labels[$next]// /-}.log"
            local start
            start=$(date +%s%3N)
            (eval "${queued_cmds[$next]}" >"$logfile" 2>&1) &
            pids+=($!)
            labels+=("${queued_labels[$next]}")
            logs+=("$logfile")
            starts+=("$start")
            next=$((next + 1))
            running=$((running + 1))
        done

        local all_done=1
        for i in "${!pids[@]}"; do
            [ "${pids[$i]}" = "done" ] && continue
            if ! kill -0 "${pids[$i]}" 2>/dev/null; then
                running=$((running - 1))
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
        # Not just "nothing running": a free slot with work still queued means the next pass starts it.
        [ "$all_done" = "1" ] && [ "$next" -ge "${#queued_labels[@]}" ] && break
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
