<script lang="ts">
    import type { DialogBadge } from "../../../../shared/dialog-model";

    // Honest-projection badge chip (1B). Renders the highest-priority badge inline and
    // lists the full set on hover - "keep readable": one chip per node/row, the rest a
    // tooltip away. The single shared renderer so a badge looks identical everywhere it
    // appears (graph card today; tree/inspector later) - the spec's consistency rule.
    let { badges, label, small = false }: { badges: DialogBadge[]; label?: string; small?: boolean } = $props();

    interface BadgeInfo {
        text: string;
        title: string;
        cls: string;
    }

    // Text carries the meaning (never colour alone); colour is a secondary cue.
    const INFO: Record<DialogBadge, BadgeInfo> = {
        derived: {
            text: "derived",
            title: "Read-only: expanded from a CHAIN/INTERJECT/EXTEND block (no source span to edit).",
            cls: "b-derived",
        },
        approximate: {
            text: "approx",
            title: "Structure simplified - this node has control flow (loop/switch) the editor can't fully model, so the shown tree is approximate and incomplete. Read the .ssl source for the full logic.",
            cls: "b-approx",
        },
        "unresolved-external": {
            text: "ext?",
            title: "Edge leaves this file to an unresolved target (e.g. a %var% filename).",
            cls: "b-ext",
        },
        computed: {
            text: "computed",
            title: "Computed message id - the shown line is approximate; the real id is built at runtime.",
            cls: "b-computed",
        },
        random: {
            text: "random",
            title: "Random message id - one of several lines shown at runtime.",
            cls: "b-computed",
        },
        conditional: {
            text: "if",
            title: "Conditional - shown only when its trigger/condition holds.",
            cls: "b-cond",
        },
        "side-effect": {
            text: "fx",
            title: "Performs a side-effect (changes game state).",
            cls: "b-fx",
        },
    };

    const primary = $derived(badges[0]);
    // Full set on hover: each badge's description, one per line.
    const fullTitle = $derived(badges.map((b) => INFO[b].title).join("\n"));
</script>

{#if primary}
    <span class="badge {INFO[primary].cls}" class:sm={small} title={fullTitle}
        >{label ?? INFO[primary].text}{#if badges.length > 1}<span class="more">+{badges.length - 1}</span>{/if}</span
    >
{/if}

<style>
    .badge {
        border-radius: 3px;
        padding: 0 4px;
        font-size: 8px;
        font-weight: 700;
        letter-spacing: 0.04em;
        white-space: nowrap;
        border: 1px solid;
    }
    .badge.sm {
        font-size: 7px;
        padding: 0 3px;
        font-weight: 600;
    }
    .more {
        margin-left: 2px;
        opacity: 0.7;
        font-weight: 400;
    }
    /* derived = read-only, neutral grey (matches the dashed read-only card). */
    .b-derived {
        color: #cbd5e1;
        background: #374151;
        border-color: #4b5563;
    }
    /* approximate = red, "caution: the shown structure is incomplete" - the strongest honesty warning. */
    .b-approx {
        color: #fca5a5;
        background: #3a1c1c;
        border-color: #b91c1c;
    }
    /* unresolved external = amber, "edge leaves the known world". */
    .b-ext {
        color: #fcd34d;
        background: #3a2f17;
        border-color: #a16207;
    }
    /* computed/random msgId = blue, "approximate / runtime". */
    .b-computed {
        color: #93c5fd;
        background: #1e2a3f;
        border-color: #3b82f6;
    }
    /* conditional = soft amber, distinct from the harder ext amber. */
    .b-cond {
        color: #fbbf24;
        background: #2c2616;
        border-color: #b4801f;
    }
    /* side-effect = teal, "changes state". */
    .b-fx {
        color: #5eead4;
        background: #142a28;
        border-color: #0d9488;
    }
</style>
