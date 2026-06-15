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
    // Honor the user's explicit subtab choice; otherwise default to the first type that actually has spells
    // (so a pure mage opens on Wizard, not a Priest tab full of empty level rows), falling back to the first.
    const active = $derived(
        types.find((t) => t.type === activeType) ??
        types.find((t) => t.knownCount + t.memorizedCount > 0) ??
        types[0],
    );
    const tabItems = $derived<TabItem[]>(
        types.map((t) => ({ id: String(t.type), label: t.typeName, count: `${t.knownCount}/${t.memorizedCount}` })),
    );

    // memorizedFlags bitfield (CreMemorizedSpellFlags): bit0 = Memorized, bit1 = Disabled.
    const MEMORIZED = 1;
    const DISABLED = 2;
    const MAX_LEVEL = 8; // spell levels 0..8 (displayed 1..9)
    const PRIEST_TYPE = 0;
    const PRIEST_MAX_LEVEL = 6; // Priest spells go to level 7 (engine limit); Wizard/Innate to 9
    const maxLevelFor = (type: number): number => (type === PRIEST_TYPE ? PRIEST_MAX_LEVEL : MAX_LEVEL);
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
    // Lowest absent level for a type's "+ add level" - fills a gap (e.g. levels [1,3] offers 2) before
    // extending past the top, so any missing level is reachable. undefined when all of the type's levels (0..its
    // max - Priest caps at 7 per the engine) are present.
    const nextLevel = (levels: readonly { level: number }[], type: number): number | undefined => {
        const present = new Set(levels.map((l) => l.level));
        for (let l = 0; l <= maxLevelFor(type); l++) if (!present.has(l)) return l;
        return undefined;
    };
    // Structural ops (reorder/duplicate of known/memorized entries) are intentionally omitted: the joined view
    // is keyed by (type, level), not by physical slot order, so positional moves carry no user-meaningful
    // result here. Add / remove / edit-resref / toggle-flags cover every spellbook change a level needs.
</script>

<div class="spellbook">
    {#if !view || view.empty}
        <p class="placeholder">No spell tables in this record.</p>
    {:else}
        {#if tabItems.length > 0}
            <Tabs variant="secondary" ariaLabel="Spell types" tabs={tabItems}
                  active={active ? String(active.type) : ""} onselect={(id) => { activeType = Number(id); }} />
        {/if}
        {#if active}
            <div class="sb-levels">
            {#each active.levels as level (level.type + ":" + level.level + ":" + (level.ownerNodeId ?? "syn"))}
                {@const effCap = level.numMemorizableEffective ?? 0}
                {@const emptyCount = Math.max(0, effCap - level.slots.length)}
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
                            {#if level.ownerNodeId !== undefined}
                                {@const ownerId = level.ownerNodeId}
                                <button class="sb-fix sb-remove-row"
                                        title="Delete this memorization row and its memorized spells"
                                        onclick={() => removeEntry(ownerId)}>Remove row</button>
                            {/if}
                        </div>
                    {/if}
                    <div class="sb-cols">
                        <div class="sb-col">
                            <div class="sb-col-head">Known</div>
                            {#each level.known as k (k.nodeId)}
                                <div class="sb-known-row">
                                    <button class="sb-x" aria-label="Remove known spell" title="Remove"
                                            disabled={level.flagged} onclick={() => removeEntry(k.nodeId)}>
                                        <Icon name="close" /></button>
                                    <input class="sb-resref" type="text" maxlength="8" value={k.resref}
                                           aria-label="Known spell resref" placeholder="resref" spellcheck="false"
                                           onchange={(e) => editResref(k.resrefNodeId, e)} />
                                    {#if level.ownerNodeId !== undefined}
                                        {@const ownerId = level.ownerNodeId}
                                        <button class="sb-arrow" title="Memorize this spell"
                                                aria-label="Memorize {k.resref}" disabled={level.flagged}
                                                onclick={() => bridge.spellbookEdit({ op: "memorize", ownerNodeId: ownerId, resref: k.resref })}>
                                            <Icon name="arrow-right" /></button>
                                    {/if}
                                </div>
                            {/each}
                            <!-- Add row mirrors the entry grid (empty remove cell) so "+ known" lines up under the resrefs. -->
                            <div class="sb-known-row">
                                <span></span>
                                <button class="sb-add" disabled={level.flagged}
                                        onclick={() => addKnown(level.type, level.level)}>+ known</button>
                            </div>
                        </div>
                        <div class="sb-col">
                            <div class="sb-mem-headrow">
                                <span>Memorized</span>
                                <span></span>
                                {#if level.slots.length > 0}
                                    <span class="sb-flags">
                                        <span class="sb-flag" title="Memorized">mem</span>
                                        <span class="sb-flag" title="Disabled">dis</span>
                                    </span>
                                {/if}
                            </div>
                            {#each level.slots as s, i (s.nodeId)}
                                {#if i === effCap && level.slots.length > effCap}
                                    <div class="sb-overcap-divider">--- over capacity ---</div>
                                {/if}
                                <div class="sb-mem-row" class:sb-slot-over={i >= effCap}>
                                    <input class="sb-resref" type="text" maxlength="8" value={s.resref}
                                           aria-label="Memorized spell resref" placeholder="resref" spellcheck="false"
                                           onchange={(e) => editResref(s.resrefNodeId, e)} />
                                    <button class="sb-x" aria-label="Unmemorize" title="Remove"
                                            disabled={level.flagged} onclick={() => removeEntry(s.nodeId)}>
                                        <Icon name="close" /></button>
                                    <span class="sb-flags">
                                        <span class="sb-flag">
                                            <Checkbox checked={hasBit(s.flags, MEMORIZED)} label="" ariaLabel="Memorized"
                                                      onchange={(c) => onedit(s.flagsNodeId, withBit(s.flags, MEMORIZED, c))} /></span>
                                        <span class="sb-flag">
                                            <Checkbox checked={hasBit(s.flags, DISABLED)} label="" ariaLabel="Disabled"
                                                      onchange={(c) => onedit(s.flagsNodeId, withBit(s.flags, DISABLED, c))} /></span>
                                    </span>
                                </div>
                            {/each}
                            {#each Array.from({ length: emptyCount }) as _slot, i (i)}
                                <div class="sb-row sb-slot-empty">
                                    <span class="sb-empty-box" title="Empty memorization slot"></span>
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
            {#if active.levels.length === 0}
                <p class="sb-empty-type">No {active.typeName} spells yet - add a level to begin.</p>
            {/if}
            {@const next = nextLevel(active.levels, active.type)}
            {#if next !== undefined}
                <button class="sb-add sb-add-level" onclick={() => addLevel(active.type, next)}>
                    + add level {next + 1} to {active.typeName}</button>
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
                        {:else if b.resolveFix}
                            {@const fix = b.resolveFix}
                            <button class="sb-fix"
                                    title="Clamp the overlapping level so it no longer claims this entry"
                                    onclick={() => onedit(fix.nodeId, fix.value)}>
                                Clamp {fix.levelLabel} to {fix.value}</button>
                        {/if}
                    </div>
                {/each}
            </div>
        {/if}
    {/if}
</div>
