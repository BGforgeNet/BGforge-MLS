<script lang="ts">
    // Where a whole SET is written, as one dialog rather than a menu and a side panel.
    //
    // Every set-scoped write goes into a folder and several need a naming family, a container and an id
    // besides, so none of them was ever one click - a menu of them was a list of entries that all opened
    // the same questions. The stage keeps drawing the source behind this, which is what a modal buys over
    // a panel in the column: the decision is the only thing being asked.
    //
    // The direction, east and naming controls open on the SET'S OWN shape, so leaving them alone writes it
    // as it stands under its own resrefs. Moving any of them is what makes this a retarget, which is when
    // the stem, the id and the section appear. That is why they are radios rather than save targets: the
    // targets were the cross product of these axes spelled out, and it made the character family read as a
    // different direction count from the cycle-numbered sixteen-point one when the two are one geometry.
    import Dialog from "../../../webview-ui/Dialog.svelte";
    import {
        type SaveAsSetupView,
        type SavePlanView,
        type SaveRequestView,
        type SetView,
        isValidBasePage,
        saveRequestKey,
    } from "../messages";

    // `let`, not `const`: `open` is written here on Save and on Cancel, and bound by the caller.
    // eslint-disable-next-line prefer-const -- bound by the caller via bind:open
    let {
        open = $bindable(false),
        set,
        setup,
        plan,
        folder,
        onPlan,
        onRun,
        onChooseFolder,
    }: {
        open: boolean;
        set: SetView;
        /** The host's defaults for the stem, the id and the section, or undefined while it is being asked. */
        setup: SaveAsSetupView | undefined;
        /** The host's answer for the current settings, or undefined while it is still being asked. */
        plan: SavePlanView | undefined;
        /** The folder the host's picker returned, or undefined until one is chosen. */
        folder: string | undefined;
        onPlan: (request: SaveRequestView) => void;
        onRun: (request: SaveRequestView) => void;
        /** Opens the host's folder picker; its answer arrives back as `folder`. */
        onChooseFolder: () => void;
    } = $props();

    const options = $derived(set.saveOptions);

    let format = $state<SaveRequestView["format"]>("bam");
    let bamVersion = $state<1 | 2>(1);
    let compressed = $state(false);
    let directions = $state<8 | 16>(8);
    let storeEast = $state(false);
    let naming = $state("cycle-numbers");
    let prefix = $state("");
    let targetId = $state(0);
    let section = $state("");
    let notes = $state(true);
    // Holds the last pose unless the reader says otherwise - the only answer that neither discards frames
    // nor restarts a rotation part-way through its own cycle.
    let unevenRotations = $state<"hold" | "clip" | "wrap">("hold");
    // The reader's own pick, or undefined while they have not made one - which is what lets the default
    // follow what is on offer instead of sticking wherever a disabled state last forced it.
    let pickedDestination = $state<"override" | "folder" | undefined>();
    // Text, not a number: the box starts EMPTY and stays empty until the reader states a page, because a
    // number the game's own archives already use shows up as corrupted graphics and nothing here knows
    // which range their mod owns. An unparsable entry is the same as none, which is what blocks Save.
    let basePageText = $state("");
    const basePage = $derived.by(() => {
        const page = Number(basePageText.trim());
        return basePageText.trim() !== "" && isValidBasePage(page) ? page : undefined;
    });

    // Seeded from the host's defaults, and the reader's from then on - re-seeding while they are typing
    // would overwrite what they entered. Keyed by the SETUP's own id rather than the open set's: the answer
    // is asynchronous, so a reader who changed set while it was in flight would otherwise seed from
    // whichever answer was on hand and then block the right one from arriving.
    let seededFor = $state<number | undefined>();
    $effect(() => {
        if (setup === undefined || seededFor === setup.id) return;
        prefix = setup.prefix;
        targetId = setup.targetId;
        section = setup.section;
        seededFor = setup.id;
    });

    // The set's own shape, so leaving the controls alone means "as it stands". Seeded once per set for the
    // same reason as above: a reader who moved a radio has said something, and a re-seed would undo it.
    let shapedFor = $state<number | undefined>();
    $effect(() => {
        if (shapedFor === set.id) return;
        directions = options.source.directions ?? 8;
        storeEast = options.source.storeEast;
        naming = options.source.naming ?? options.namings[0]?.id ?? "cycle-numbers";
        compressed = false;
        shapedFor = set.id;
    });

    /** Whether the source can fill a geometry - the radios show every one and disable the rest. */
    function reachable(count: 8 | 16, east: boolean): boolean {
        return options.geometries.some((geometry) => geometry.directions === count && geometry.storeEast === east);
    }
    const anyGeometry = $derived(options.geometries.length > 0);
    // A geometry stays selectable when it is the source's OWN, even where nothing could be converted into
    // it: writing the set as it stands is not a conversion and has nothing to fill.
    const own = $derived(
        (count: 8 | 16, east: boolean) => options.source.directions === count && options.source.storeEast === east,
    );

    // The set came OUT of the game's override folder, so writing it back as it stands goes there by
    // default - it is the one destination where the files are the ones the engine already names. Offered
    // only there: a reshaped set is an animation nothing declares yet, and an APNG or a folder of PNGs is
    // not a file any game reads, so both of those go somewhere of the reader's own.
    const overrideAllowed = $derived(format === "bam" && plan?.retarget !== true);
    const destination = $derived<"override" | "folder">(
        overrideAllowed ? (pickedDestination ?? "override") : "folder",
    );

    const request = $derived<SaveRequestView>({
        format,
        bamVersion,
        compressed,
        directions,
        storeEast,
        naming,
        prefix,
        targetId,
        section,
        notes,
        destination,
        ...(basePage === undefined ? {} : { basePage }),
        ...(folder === undefined ? {} : { folder }),
        ...(format === "frm" ? { unevenRotations } : {}),
    });

    // Asked of the host on every change, because the file names and the destination are what the reader is
    // deciding between and both follow from the whole request rather than from any one control.
    $effect(() => {
        if (open) onPlan(request);
    });

    const hex = $derived(`0x${targetId.toString(16).padStart(4, "0")}`);
    const retarget = $derived(plan?.retarget === true);
    // The plan on screen can be one round trip behind what the controls now say, so Save waits for the
    // answer to THESE settings: pressed against a stale preview it ran a save the reader had not seen
    // planned, including ones the planner would have refused.
    const answered = $derived(plan !== undefined && plan.for === saveRequestKey(request));
    const blocked = $derived(
        !answered ||
            plan?.outcome === "refused" ||
            (plan?.needsBasePage === true && basePage === undefined) ||
            (destination === "folder" && folder === undefined),
    );

    function save(): void {
        onRun(request);
        open = false;
    }
</script>

<Dialog bind:open title="Save {set.title} as">
    {#snippet body()}
        <fieldset class="dialog-group">
            <legend>Write as</legend>
            <label><input type="radio" bind:group={format} value="bam" /> Infinity Engine BAM</label>
            <label><input type="radio" bind:group={format} value="frm" /> Fallout FRM</label>
            <label><input type="radio" bind:group={format} value="apng" /> APNG</label>
            <label><input type="radio" bind:group={format} value="png-directory" /> PNG directory</label>
        </fieldset>

        {#if format === "bam"}
            <fieldset class="dialog-group">
                <legend>Container</legend>
                <label><input type="radio" bind:group={bamVersion} value={1} /> BAM v1</label>
                <label><input type="radio" bind:group={bamVersion} value={2} /> BAM v2, true colour</label>
                <label class:dialog-disabled={bamVersion === 2}>
                    <input type="checkbox" bind:checked={compressed} disabled={bamVersion === 2} />
                    Compressed (BAMC)
                </label>
            </fieldset>

            <!-- Asked here rather than after the folder picker, and only where the host says the frames
                 need pages of their own: by the time a folder has been chosen the reader has finished
                 deciding, and a question arriving then reads as the save having gone wrong. -->
            {#if plan?.needsBasePage === true}
                <label class="dialog-field" title="The MOS<nnnn>.PVRZ page the frames start at">
                    <span class="dialog-label">First PVRZ page</span>
                    <input
                        type="text"
                        inputmode="numeric"
                        maxlength="4"
                        placeholder="0 - 9999"
                        bind:value={basePageText}
                        aria-label="First PVRZ page"
                    />
                    <span class="dialog-hex">
                        Pick a range your mod owns - reusing a number the game ships corrupts its graphics.
                    </span>
                </label>
            {/if}

            <fieldset class="dialog-group" class:dialog-disabled={!anyGeometry}>
                <legend>Directions</legend>
                {#if anyGeometry}
                    {#each [8, 16] as const as count (count)}
                        <label
                            class:dialog-disabled={!reachable(count, storeEast) && !own(count, storeEast)}
                            title={reachable(count, storeEast) || own(count, storeEast)
                                ? ""
                                : `This set has no art for the facings a ${count}-direction band stores`}
                        >
                            <input
                                type="radio"
                                bind:group={directions}
                                value={count}
                                disabled={!reachable(count, storeEast) && !own(count, storeEast)}
                            />
                            {count} directions
                        </label>
                    {/each}
                    <label
                        class:dialog-disabled={!reachable(directions, true) && !own(directions, true)}
                        title="The engine reads this from the declaration, never by looking for the files - so the declaration written beside the art says the same thing"
                    >
                        <input
                            type="checkbox"
                            bind:checked={storeEast}
                            disabled={!reachable(directions, true) && !own(directions, true)}
                        />
                        Store the east in the files
                    </label>
                {:else}
                    <p class="dialog-note">This animation's cycles are not directions, so there is nothing to set.</p>
                {/if}
            </fieldset>

            <fieldset class="dialog-group" class:dialog-disabled={!anyGeometry}>
                <legend>Names</legend>
                {#each options.namings as entry (entry.id)}
                    <label class:dialog-disabled={!anyGeometry}>
                        <input type="radio" bind:group={naming} value={entry.id} disabled={!anyGeometry} />
                        {entry.label}
                    </label>
                {/each}
            </fieldset>
        {/if}

        <!-- Only where this source's rotations actually differ, which the host answers by running the
             conversion: for one whose facings already agree, every answer here writes the same six files.
             The per-direction .fr0-.fr5 split is deliberately not offered - it has no writer on this path,
             so a control for it would have changed none of the files it named. -->
        {#if format === "frm" && plan?.unevenRotations === true}
            <fieldset class="dialog-group">
                <legend>Directions of unequal length</legend>
                <label title="Every frame is kept; a short direction shows its last pose until the others finish">
                    <input type="radio" bind:group={unevenRotations} value="hold" />
                    Hold the last frame
                </label>
                <label title="Every direction ends together; the frames past the shortest one are not written">
                    <input type="radio" bind:group={unevenRotations} value="clip" />
                    Cut them all to the shortest
                </label>
                <label title="Every frame is kept; a short direction starts over, as the editor plays it">
                    <input type="radio" bind:group={unevenRotations} value="wrap" />
                    Keep the short ones looping
                </label>
            </fieldset>
        {/if}


        {#if retarget}
            <label class="dialog-field" title="The stem the written files are named from">
                <span class="dialog-label">Name</span>
                <input type="text" maxlength="6" bind:value={prefix} aria-label="Target file stem" />
            </label>
            <!-- Both belong to an INFINITY ENGINE declaration and nothing on the Fallout path reads either:
                 a critter is declared by its position in an art list, keyed off the stem above. Drawn for
                 that path they were two boxes whose contents changed no file. -->
            {#if format === "bam"}
                <label class="dialog-field" title="The id the set is to be declared under">
                    <span class="dialog-label">Id</span>
                    <input type="number" min="0" bind:value={targetId} aria-label="Target animation id" />
                    <!-- The number is what the box takes; the tables name an animation in hex, so the same
                         value is shown the way the reader will have to write it down. -->
                    <span class="dialog-hex">declared as {hex}</span>
                </label>
                <!-- A list, not a box to type in: the declaration's header is a vocabulary the engine reads,
                     and a typed one it does not know declares nothing at all. -->
                <label class="dialog-field" title="The family the written declaration names">
                    <span class="dialog-label">Section</span>
                    <select bind:value={section} aria-label="Declared section">
                        <!-- The absence, named: a set whose install declared no family leaves nothing to
                             seed this from, and the writer puts no declaration beside the art rather than
                             one headed by a family nobody stated. -->
                        <option value="">Not declared</option>
                        {#each options.sections as entry (entry.id)}
                            <option value={entry.id}>{entry.label}</option>
                        {/each}
                    </select>
                </label>
            {/if}
            <label class="dialog-check">
                <input type="checkbox" bind:checked={notes} />
                Write the notes file
            </label>
        {/if}

        <fieldset class="dialog-group">
            <legend>Destination</legend>
            <!-- Checked from the EFFECTIVE destination rather than bound to the pick: where the override is
                 not on offer the radio is disabled, and one that is disabled and checked at the same time
                 says the save is going somewhere it is not. -->
            <label class:dialog-disabled={!overrideAllowed} title={overrideAllowed
                ? options.overridePath
                : "Only a set written as it stands, as Infinity Engine files, is something the game already names"}>
                <input
                    type="radio"
                    name="destination"
                    checked={destination === "override"}
                    disabled={!overrideAllowed}
                    onchange={() => (pickedDestination = "override")}
                />
                The game's override folder
            </label>
            <label>
                <input
                    type="radio"
                    name="destination"
                    checked={destination === "folder"}
                    onchange={() => (pickedDestination = "folder")}
                />
                A folder you choose
            </label>
        </fieldset>

        <!-- Picked from inside the dialog. It used to be a picker sprung after Save, which put the last
             question of the save after the moment the reader had finished deciding. -->
        {#if destination === "folder"}
            <div class="dialog-field">
                <span class="dialog-label">Folder</span>
                <span class="dialog-path">{folder ?? "None chosen yet"}</span>
                <button type="button" onclick={onChooseFolder}>Choose...</button>
            </div>
        {/if}

        <!-- The destination is named here rather than under its own radios, where it could only repeat the
             one the reader had just picked. Beside the file names it says the other half of where they go. -->
        <div class="dialog-plan">
            {#if plan === undefined || !answered}
                <p class="dialog-note">Working out what this would write...</p>
            {:else if plan.outcome === "refused"}
                <p class="dialog-refused">{plan.reason}</p>
            {:else}
                <p class="dialog-note">
                    {plan.files}
                    {plan.files === 1 ? "file" : "files"}, {plan.outcome === "lossless"
                        ? "nothing lost"
                        : "with losses"}, into {plan.destination}
                </p>
                <p class="dialog-files">
                    {plan.shown.join(", ")}{plan.files > plan.shown.length
                        ? ` and ${plan.files - plan.shown.length} more`
                        : ""}
                </p>
                {#if plan.losses.length > 0}
                    <ul class="dialog-losses">
                        {#each plan.losses as loss (loss)}
                            <li>{loss}</li>
                        {/each}
                    </ul>
                {/if}
                {#if plan.notes.length > 0}
                    <ul class="dialog-notes">
                        {#each plan.notes as note (note)}
                            <li>{note}</li>
                        {/each}
                    </ul>
                {/if}
            {/if}
        </div>
    {/snippet}

    {#snippet footer()}
        <button type="button" onclick={() => (open = false)}>Cancel</button>
        <button type="button" disabled={blocked} onclick={save}>Save...</button>
    {/snippet}
</Dialog>
