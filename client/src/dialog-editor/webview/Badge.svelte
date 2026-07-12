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
        color: var(--vscode-descriptionForeground);
        background: var(--vscode-editorWidget-background);
        border-color: var(--vscode-panel-border);
    }
    /* approximate = red, "caution: the shown structure is incomplete" - the strongest honesty warning.
       Uses the same error-validation triad as the rest of the editor's error surfaces (rgba fallback
       matches the convention already used by the binary editor's diagnostics banner). */
    .b-approx {
        color: var(--vscode-errorForeground);
        background: var(--vscode-inputValidation-errorBackground, rgba(190, 17, 28, 0.15));
        border-color: var(--vscode-inputValidation-errorBorder, var(--vscode-editorError-foreground));
    }
    /* unresolved external = amber, "edge leaves the known world". */
    .b-ext {
        /* inputValidation-warningForeground (falls back to plain foreground), not editorWarning-foreground -
           the latter is tuned for squiggles/icons and fails WCAG contrast against the warning background
           wash in light themes (verified: ~2.8:1, below the 4.5:1 text floor). */
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    }
    /* computed/random msgId = blue, "approximate / runtime". */
    .b-computed {
        color: var(--vscode-editorInfo-foreground);
        background: var(--vscode-inputValidation-infoBackground, rgba(0, 122, 204, 0.12));
        border-color: var(--vscode-inputValidation-infoBorder, var(--vscode-editorInfo-foreground));
    }
    /* conditional = soft amber, distinct from the harder ext amber in the old fixed palette; VS Code has
       one amber family, so both now share the warning triad - the badge TEXT ("if" vs "ext?") is what
       actually distinguishes them (Badge's own contract: text carries the meaning, colour is secondary). */
    .b-cond {
        /* inputValidation-warningForeground (falls back to plain foreground), not editorWarning-foreground -
           the latter is tuned for squiggles/icons and fails WCAG contrast against the warning background
           wash in light themes (verified: ~2.8:1, below the 4.5:1 text floor). */
        color: var(--vscode-inputValidation-warningForeground, var(--vscode-foreground));
        background: var(--vscode-inputValidation-warningBackground, rgba(204, 167, 0, 0.15));
        border-color: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-foreground));
    }
    /* side-effect = teal in the old palette; VS Code has no dedicated teal token, so this reuses
       charts.purple - the same "affects game state" hue as the action [do] chip and the low-INT chip. */
    .b-fx {
        color: var(--vscode-charts-purple);
        background: var(--vscode-editorWidget-background);
        border-color: var(--vscode-charts-purple);
    }
</style>
