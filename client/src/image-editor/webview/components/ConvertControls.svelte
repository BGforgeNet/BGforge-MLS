<script lang="ts">
    // Converting the open set into another game's files, as a mode of this same editor rather than a
    // window of its own: the stage keeps drawing the SOURCE while these controls hold the target, so the
    // reader is looking at the animation they are about to convert while they choose what it becomes.
    //
    // The plan is asked of the host per TARGET, not per keystroke: what a conversion costs follows from
    // the target alone, while the stem and the id only decide what the files are called.
    import { untrack } from "svelte";
    import type { ConversionPlanView, ConversionSetupView } from "../messages";

    const {
        setup,
        plan,
        onPlan,
        onRun,
        onClose,
    }: {
        setup: ConversionSetupView;
        /** The host's answer for the chosen target, or undefined while it is still being asked. */
        plan: ConversionPlanView | undefined;
        onPlan: (profileId: string) => void;
        onRun: (request: { profileId: string; prefix: string; targetId: number; notes: boolean }) => void;
        onClose: () => void;
    } = $props();

    // Seeded once, deliberately: the setup is the host's OPENING offer, and the three fields below are the
    // reader's from then on. Tracking it would overwrite what they had typed the next time it arrived.
    let profileId = $state(untrack(() => setup.profiles[0]?.id ?? ""));
    let prefix = $state(untrack(() => setup.prefix));
    let targetId = $state(untrack(() => setup.targetId));
    let notes = $state(true);

    // Ask on open and on every change of target, so the panel never shows a plan for a target other than
    // the one the control names.
    $effect(() => {
        if (profileId !== "") onPlan(profileId);
    });

    const current = $derived(plan?.profileId === profileId ? plan : undefined);
    const hex = $derived(`0x${targetId.toString(16).padStart(4, "0")}`);
</script>

<div class="view-controls" role="group" aria-label="Convert this animation set">
    <div class="convert-head">
        <span class="view-label">Convert to</span>
        <button type="button" class="convert-close" onclick={onClose} title="Back to the set's own controls">
            Cancel
        </button>
    </div>

    <label class="view-field" title="Which game and naming family the converted set is written for">
        <span class="view-label">Target</span>
        <select bind:value={profileId} aria-label="Conversion target">
            {#each setup.profiles as profile (profile.id)}
                <option value={profile.id}>{profile.label}</option>
            {/each}
        </select>
    </label>

    <label class="view-field" title="The stem the converted files are named from">
        <span class="view-label">Name</span>
        <input type="text" maxlength="6" bind:value={prefix} aria-label="Target file stem" />
    </label>

    <label class="view-field" title="The id the converted set is to be declared under, stated in the notes">
        <span class="view-label">Id</span>
        <input type="number" min="0" bind:value={targetId} aria-label="Target animation id" />
        <!-- The number is what the box takes; the tables name an animation in hex, so the same value is
             shown the way the reader will have to write it down. -->
        <span class="convert-hex">declared as {hex}</span>
    </label>

    <label class="view-check" title="A short file beside the output: what to declare by hand, and what the conversion cost">
        <input type="checkbox" bind:checked={notes} />
        Write the notes file
    </label>

    {#if current === undefined}
        <p class="convert-note">Working out what this would cost...</p>
    {:else if current.outcome === "refused"}
        <p class="convert-refused">{current.reason}</p>
    {:else}
        <p class="convert-summary">
            {current.files}
            {current.files === 1 ? "file" : "files"}, {current.outcome === "lossless" ? "nothing lost" : "with losses"}
        </p>
        {#if current.losses.length > 0}
            <ul class="convert-losses">
                {#each current.losses as loss (loss)}
                    <li>{loss}</li>
                {/each}
            </ul>
        {/if}
        {#if current.notes.length > 0}
            <ul class="convert-notes">
                {#each current.notes as note (note)}
                    <li>{note}</li>
                {/each}
            </ul>
        {/if}
    {/if}

    <button
        type="button"
        class="convert-run"
        disabled={current === undefined || current.outcome === "refused"}
        onclick={() => onRun({ profileId, prefix, targetId, notes })}
    >
        Convert...
    </button>
</div>
