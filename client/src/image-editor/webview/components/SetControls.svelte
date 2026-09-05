<script lang="ts">
    // The two controls a whole animation set adds to the editor: which armour level, and which action.
    // Everything else on this surface is the single-file editor unchanged, which is the point - a set is
    // not a second viewer, it is the same one with a picker for what it is pointed at.
    //
    // Plain selects rather than the searchable combobox the creature picker uses: an armour level offers at
    // most four options and an action list around twenty, all of them visible at once in a native list.
    import type { SetView } from "../messages";

    const {
        set,
        onArmourChange,
        onActionChange,
    }: {
        set: SetView;
        onArmourChange: (level: number) => void;
        onActionChange: (resref: string) => void;
    } = $props();
</script>

<div class="view-controls" role="group" aria-label="Animation set">
    <p class="set-title">{set.title}</p>
    {#if set.armours.length > 1}
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
            value={set.action}
            onchange={(e) => onActionChange(e.currentTarget.value)}
            aria-label="Set action"
        >
            {#each set.actions as action (action.resref)}
                <option value={action.resref}>{action.label}</option>
            {/each}
        </select>
    </label>
</div>
