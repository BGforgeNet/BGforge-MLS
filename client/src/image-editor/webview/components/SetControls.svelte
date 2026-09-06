<script lang="ts">
    // The two controls a whole animation set adds to the editor: which armour level, and which action.
    // Everything else on this surface is the single-file editor unchanged, which is the point - a set is
    // not a second viewer, it is the same one with a picker for what it is pointed at.
    //
    // Plain selects rather than the searchable combobox the creature picker uses: an armour level offers at
    // most four options and an action list around twenty, all of them visible at once in a native list.
    //
    // The SET is the exception: an install declares hundreds, so choosing one is a search rather than a
    // list, and the host's own quick pick already is that search. This is the button that opens it - and
    // it is omitted where the surface around this column already carries a set picker of its own, so one
    // panel never offers the same choice twice.
    import type { SetView } from "../messages";

    const {
        set,
        showChoice = true,
        onArmourChange,
        onActionChange,
        onPickSet,
        onConvert,
    }: {
        /**
         * Null while nothing is chosen: this column is drawn from the moment its tab opens, so the Action
         * picker and the convert button hold their places and fill in when a set arrives.
         */
        set: SetView | null;
        /** Whether choosing the SET belongs here, or to the surface around this column. */
        showChoice?: boolean;
        onArmourChange: (level: number) => void;
        onActionChange: (resref: string) => void;
        onPickSet: () => void;
        /** Open the conversion mode, which takes over this column while it is up. */
        onConvert: () => void;
    } = $props();
</script>

<div class="view-controls" role="group" aria-label="Animation set">
    {#if showChoice}
        <label class="view-field" title="Which animation set this editor is pointed at">
            <span class="view-label">Set</span>
            <button type="button" class="set-pick" onclick={onPickSet}>{set?.title ?? ""}</button>
        </label>
    {/if}
    {#if set !== null && set.armours.length > 1}
        <label class="view-field" title="Which armour level's files this set draws from">
            <span class="view-label">Armour</span>
            <select
                value={String(set.armour)}
                onchange={(e) => onArmourChange(Number(e.currentTarget.value))}
                aria-label="Armour level"
            >
                {#each set.armours as level (level.level)}
                    <option value={String(level.level)}>{level.label}</option>
                {/each}
            </select>
        </label>
    {/if}
    <label class="view-field" title="Which of the set's animations to show">
        <span class="view-label">Action</span>
        <select
            value={set?.action}
            onchange={(e) => onActionChange(e.currentTarget.value)}
            aria-label="Set action"
        >
            {#each set?.actions ?? [] as action (action.resref)}
                <option value={action.resref}>{action.label}</option>
            {/each}
        </select>
    </label>
    <button type="button" class="convert-open" onclick={onConvert}>
        Convert this set...
    </button>
</div>
