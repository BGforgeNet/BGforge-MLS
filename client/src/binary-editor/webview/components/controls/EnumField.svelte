<script lang="ts">
    import type { Row } from "@bgforge/binary-editor";
    import { enumOptionList } from "../../state/controls";
    import Select from "../primitives/Select.svelte";

    const { row, onedit }: { row: Row; onedit: (value: number) => void } = $props();
    const options = $derived(enumOptionList(row));
    const current = $derived(typeof row.rawValue === "number" ? row.rawValue : Number(row.rawValue));

    // The control is chosen from the spec, not a heuristic: a field is an enum because the spec declares
    // `enum:`, so it always renders as a dropdown. Select carries bits-ui's built-in keyboard typeahead,
    // so even large enums stay searchable without a separate combobox. Out-of-range values surface as an
    // Unknown(N) option from enumOptionList. If a specific field ever needs substring search, that should
    // be a spec/presentation flag, not an option-count threshold.
</script>

<Select {options} value={current} onchange={onedit} disabled={!row.editable} ariaLabel={row.name} />
