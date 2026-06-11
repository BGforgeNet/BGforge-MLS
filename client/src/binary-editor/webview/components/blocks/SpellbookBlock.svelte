<script lang="ts">
    // Unified CRE spellbook: the joined view of Known Spells + Spell Memorization Info + Memorized Spells,
    // organized as spell-type subtabs (Priest / Wizard / Innate) over per-level cards. The host computes the
    // join (projectSpellbook) and ships a SpellbookView; this component renders it and re-fetches on every
    // version bump (mirroring ListSection). Inconsistent on-disk data renders losslessly: entries not cleanly
    // owned by one level sit in the Unassigned bucket, and a level whose range is flagged disables its
    // structural edits (add/remove) - index-stable edits (resref, flags, slot counts) stay enabled - until the
    // user resolves it.
    import type { SpellbookView } from "@bgforge/binary-editor";
    import type { Bridge } from "../../state/bridge";
    import Tabs, { type TabItem } from "../primitives/Tabs.svelte";
    import Checkbox from "../primitives/Checkbox.svelte";
    import Icon from "../Icon.svelte";

    const { bridge, version, onedit }: {
        bridge: Bridge;
        version: number;
        onedit: (id: string, v: number | string) => void;
    } = $props();

    let view = $state<SpellbookView | undefined>();
    // eslint-disable-next-line prefer-const -- reassigned via the type-subtab onselect
    let activeType = $state<number | undefined>();

    $effect(() => {
        void version;
        let cancelled = false;
        bridge.requestSpellbook().then((v) => {
            if (!cancelled) view = v;
        });
        return () => { cancelled = true; };
    });

    const types = $derived(view?.types ?? []);
    const active = $derived(types.find((t) => t.type === activeType) ?? types[0]);
    const tabItems = $derived<TabItem[]>(types.map((t) => ({ id: String(t.type), label: t.typeName })));

    // memorizedFlags bitfield (CreMemorizedSpellFlags): bit0 = Memorized, bit1 = Disabled.
    const MEMORIZED = 1;
    const DISABLED = 2;
    const MAX_LEVEL = 8; // spell levels 0..8 (displayed 1..9)
    const hasBit = (flags: number, bit: number): boolean => (flags & bit) !== 0;
    const withBit = (flags: number, bit: number, on: boolean): number => (on ? flags | bit : flags & ~bit);

    const editResref = (nodeId: string, e: Event): void =>
        onedit(nodeId, (e.currentTarget as HTMLInputElement).value);
    const removeEntry = (nodeId: string): void => bridge.structureOp({ op: "remove", entryId: nodeId });
    const memorize = (ownerNodeId: string): void => bridge.spellbookEdit({ op: "memorize", ownerNodeId, resref: "" });
    const addKnown = (spellType: number, spellLevel: number): void =>
        bridge.spellbookEdit({ op: "addKnown", spellType, spellLevel, resref: "" });
    const addLevel = (spellType: number, spellLevel: number): void =>
        bridge.spellbookEdit({ op: "addLevel", spellType, spellLevel });
    // Next absent level for a type's "+ add level" (one past its highest current level).
    const nextLevel = (levels: readonly { level: number }[]): number =>
        Math.max(-1, ...levels.map((l) => l.level)) + 1;
</script>

<div class="spellbook">
    {#if !view || view.empty}
        <p class="placeholder">No spells known or memorized.</p>
    {:else}
        {#if tabItems.length > 0}
            <Tabs variant="secondary" ariaLabel="Spell types" tabs={tabItems}
                  active={active ? String(active.type) : ""} onselect={(id) => { activeType = Number(id); }} />
        {/if}
        {#if active}
            <div class="sb-levels">
            {#each active.levels as level (level.type + ":" + level.level + ":" + (level.ownerNodeId ?? "syn"))}
                <div class="sb-level" class:sb-flagged={level.flagged}>
                    <div class="sb-level-head">
                        <span class="sb-level-name">Level {level.level + 1}</span>
                        {#if level.numMemorizableNodeId !== undefined && level.numMemorizableEffectiveNodeId !== undefined}
                            {@const baseId = level.numMemorizableNodeId}
                            {@const effId = level.numMemorizableEffectiveNodeId}
                            <span class="sb-counts">
                                <span class="sb-counts-sep">slots</span>
                                <label class="sb-num-lbl">base
                                    <input class="sb-num" type="number" min="0" value={level.numMemorizable}
                                           aria-label="Spells memorizable (base)"
                                           onchange={(e) => onedit(baseId, Number(e.currentTarget.value))} /></label>
                                <label class="sb-num-lbl">eff
                                    <input class="sb-num" type="number" min="0" value={level.numMemorizableEffective}
                                           aria-label="Spells memorizable (effective)"
                                           onchange={(e) => onedit(effId, Number(e.currentTarget.value))} /></label>
                            </span>
                        {/if}
                        <span class="sb-mem-count">{level.slots.length} memorized</span>
                    </div>
                    {#if level.flagged}
                        <div class="sb-flag-note">
                            <Icon name="warning" />
                            <span class="sb-flag-text">{level.flagReasons.join("; ")} - resolve to edit</span>
                            {#if level.clampCountFix}
                                {@const fix = level.clampCountFix}
                                <button class="sb-fix" onclick={() => onedit(fix.nodeId, fix.value)}>
                                    Clamp count to {fix.value}</button>
                            {/if}
                        </div>
                    {/if}
                    <div class="sb-cols">
                        <div class="sb-col">
                            <div class="sb-col-head">Known</div>
                            {#each level.known as k (k.nodeId)}
                                <div class="sb-row">
                                    <input class="sb-resref" type="text" maxlength="8" value={k.resref}
                                           aria-label="Known spell resref" placeholder="resref" spellcheck="false"
                                           onchange={(e) => editResref(k.resrefNodeId, e)} />
                                    <button class="sb-x" aria-label="Remove known spell" title="Remove"
                                            disabled={level.flagged} onclick={() => removeEntry(k.nodeId)}>
                                        <Icon name="close" /></button>
                                </div>
                            {/each}
                            <button class="sb-add" disabled={level.flagged}
                                    onclick={() => addKnown(level.type, level.level)}>+ known</button>
                        </div>
                        <div class="sb-col">
                            <div class="sb-col-head">Memorized</div>
                            {#each level.slots as s (s.nodeId)}
                                <div class="sb-row">
                                    <input class="sb-resref" type="text" maxlength="8" value={s.resref}
                                           aria-label="Memorized spell resref" placeholder="resref" spellcheck="false"
                                           onchange={(e) => editResref(s.resrefNodeId, e)} />
                                    <span class="sb-slot-flags">
                                        <Checkbox checked={hasBit(s.flags, MEMORIZED)} label="mem"
                                                  onchange={(c) => onedit(s.flagsNodeId, withBit(s.flags, MEMORIZED, c))} />
                                        <Checkbox checked={hasBit(s.flags, DISABLED)} label="disabled"
                                                  onchange={(c) => onedit(s.flagsNodeId, withBit(s.flags, DISABLED, c))} />
                                    </span>
                                    <button class="sb-x" aria-label="Unmemorize" title="Remove"
                                            disabled={level.flagged} onclick={() => removeEntry(s.nodeId)}>
                                        <Icon name="close" /></button>
                                </div>
                            {/each}
                            {#if level.ownerNodeId !== undefined}
                                {@const owner = level.ownerNodeId}
                                <button class="sb-add" disabled={level.flagged} onclick={() => memorize(owner)}>
                                    + memorize</button>
                            {/if}
                        </div>
                    </div>
                </div>
            {/each}
            </div>
            {#if nextLevel(active.levels) <= MAX_LEVEL}
                <button class="sb-add sb-add-level"
                        onclick={() => addLevel(active.type, nextLevel(active.levels))}>
                    + add level {nextLevel(active.levels) + 1} to {active.typeName}</button>
            {/if}
        {/if}
        {#if view.bucket.length > 0}
            <div class="sb-bucket">
                <div class="sb-bucket-head">
                    <Icon name="warning" /> Unassigned memorized spells (not cleanly owned by one level)
                </div>
                {#each view.bucket as b (b.nodeId)}
                    <div class="sb-bucket-row">
                        <span class="sb-slot-name">#{b.memorizedIndex} {b.resref || "(empty)"}</span>
                        <span class="sb-bucket-reason">
                            {b.reason === "orphan"
                                ? "not assigned to any level"
                                : `claimed by ${(b.claimedBy ?? []).join(" and ")}`}
                        </span>
                        {#if b.reason === "orphan"}
                            <button class="sb-fix" title="Drop this orphaned memorized spell"
                                    onclick={() => bridge.spellbookEdit({ op: "removeOrphan", memorizedIndex: b.memorizedIndex })}>
                                Remove</button>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>
