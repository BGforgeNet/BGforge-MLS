<script lang="ts">
    // Bitflags regrouped by semantic CATEGORY rather than by the byte that stores them (the ITM usability and
    // kit bytes: a category's bits are scattered across several byte fields). The block owns the column layout:
    // `columns` lay left-to-right, each column stacks one or more boxed, labelled subgroups, and each checkbox
    // names its own backing field + single-bit mask. Toggling composes back into that byte via the same
    // compose/decompose helpers FlagColumns uses, so the round-trip identity is unchanged.
    import type { FieldRef, Row } from "@bgforge/binary-editor";
    import { composeFlags } from "../../state/controls";
    import Checkbox from "../primitives/Checkbox.svelte";
    import Icon from "../Icon.svelte";

    interface Item {
        field: FieldRef;
        mask: number;
        label?: string;
    }
    interface Group {
        label: string;
        items: Item[];
        columns?: number;
    }

    const { columns, fields, onedit, bulkSelect = false }: {
        columns: Group[][];
        fields: Record<FieldRef, Row>;
        onedit: (id: string, v: number | string) => void;
        bulkSelect?: boolean;
    } = $props();

    const raw = (row: Row | undefined): number =>
        row ? (typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue ?? 0)) : 0;

    // Split a subgroup's items into `n` vertical sub-columns, filling column 0 first (column-major, so
    // byte/bit order reads top-to-bottom then left-to-right). Mirrors FlagColumns' split.
    function subColumns(group: Group): Item[][] {
        const n = group.columns ?? 1;
        const perCol = Math.ceil(group.items.length / n);
        return Array.from({ length: n }, (_, c) => group.items.slice(c * perCol, (c + 1) * perCol)).filter(
            (c) => c.length > 0,
        );
    }

    // Default checkbox label is the backing byte's own flag-table name (single source of truth); the block's
    // optional `label` overrides it for terser display (e.g. "Cleric of Talos" -> "Talos").
    const labelOf = (item: Item, row: Row | undefined): string =>
        item.label ?? row?.flagOptions?.[String(item.mask)] ?? `0x${item.mask.toString(16)}`;

    function toggle(item: Item, checked: boolean): void {
        const row = fields[item.field];
        if (!row) return;
        onedit(row.id, composeFlags(raw(row), item.mask, checked));
    }

    // Select/deselect a set of items. Bits are spread across several byte fields, so OR each field's masks
    // together and emit one edit per field (setting/clearing only the bits in `items`, not the whole byte).
    // Each byte is independent, so the pre-edit snapshot in `fields` stays valid across the loop. Used by the
    // panel-level bar (all items) and the per-group buttons (one group's items).
    function setItems(items: Item[], set: boolean): void {
        const maskByField = new Map<FieldRef, number>();
        for (const item of items) maskByField.set(item.field, (maskByField.get(item.field) ?? 0) | item.mask);
        for (const [field, mask] of maskByField) {
            const row = fields[field];
            if (!row || !row.editable) continue;
            onedit(row.id, composeFlags(raw(row), mask, set));
        }
    }
    const allItems = (): Item[] => columns.flatMap((col) => col.flatMap((g) => g.items));
</script>
<div class="flag-groups">
    <div class="flag-group-cols">
        {#each columns as col, ci (ci)}
            <div class="flag-group-col">
                {#each col as group, gi (gi)}
                    <fieldset class="flag-group">
                        <legend>
                            <span class="flag-group-name">{group.label}</span>
                            {#if bulkSelect}
                                <span class="flag-group-actions">
                                    <button type="button" class="flag-group-btn"
                                            aria-label={`Select all ${group.label}`} title={`Select all ${group.label}`}
                                            onclick={() => setItems(group.items, true)}><Icon name="check-all" /></button>
                                    <button type="button" class="flag-group-btn"
                                            aria-label={`Deselect all ${group.label}`} title={`Deselect all ${group.label}`}
                                            onclick={() => setItems(group.items, false)}><Icon name="clear-all" /></button>
                                </span>
                            {/if}
                        </legend>
                        <div class="flag-columns">
                            {#each subColumns(group) as sub, si (si)}
                                <div class="gcol">
                                    {#each sub as item (item.field + ":" + item.mask)}
                                        {@const row = fields[item.field]}
                                        <Checkbox checked={(raw(row) & item.mask) !== 0} label={labelOf(item, row)}
                                                  disabled={!row?.editable} onchange={(checked) => toggle(item, checked)} />
                                    {/each}
                                </div>
                            {/each}
                        </div>
                    </fieldset>
                {/each}
            </div>
        {/each}
    </div>
    {#if bulkSelect}
        <div class="flag-bulk">
            <button type="button" class="flag-bulk-btn" onclick={() => setItems(allItems(), true)}>Select all</button>
            <button type="button" class="flag-bulk-btn" onclick={() => setItems(allItems(), false)}>Deselect all</button>
        </div>
    {/if}
</div>
