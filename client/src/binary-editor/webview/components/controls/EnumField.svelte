<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList, isLargeEnum } from "../../state/controls";
    import Select from "../primitives/Select.svelte";
    import Combobox from "../primitives/Combobox.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));

    // The Row type carries no open-vs-closed enum distinction (valueType is always "enum" with no variant).
    // Unknown(N) entries in enumOptionList show that arbitrary numeric values can legitimately occur, but
    // those values are already surfaced as labelled options by enumOptionList. Accepting free-form numeric
    // entry via the combobox allowCustom mode would bypass that labelling. Keeping allowCustom=false (closed)
    // ensures users always pick from the listed options; Unknown(N) appears in the list for out-of-range values.
    // Revisit if the Row type gains an explicit open-enum indicator.
    const large = $derived(isLargeEnum(options.length));
</script>

{#if large}
    <Combobox
        {options}
        value={current}
        onchange={onedit}
        disabled={!row.editable}
        allowCustom={false}
        ariaLabel={row.name}
    />
{:else}
    <Select
        {options}
        value={current}
        onchange={onedit}
        disabled={!row.editable}
        ariaLabel={row.name}
    />
{/if}
