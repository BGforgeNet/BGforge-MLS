<script lang="ts">
    // A resref field with a game open: the install's resources of the field's type become suggestions in the
    // same searchable combobox every enum uses.
    //
    // ALWAYS open-ended - `allowCustom` is unconditional here, where an enum gates it on `enumOpen`. A resref
    // legitimately names a resource a later install step creates, which is the same fact the open-chip encodes
    // by staying absent rather than flagging an unresolved name; confining the field to what is installed today
    // would reject correct input. The list is a suggestion set, never the domain.
    import type { Row } from "@bgforge/binary-editor";
    import Combobox from "../primitives/Combobox.svelte";
    import { useResourceList } from "../../state/resource-list-context";

    const { row, onedit }: { row: Row; onedit: (value: string) => void } = $props();
    const fetchList = useResourceList();

    let resrefs = $state<readonly string[]>([]);
    // Loaded on first open rather than on mount: a record carries many resref fields and their lists run to
    // thousands of entries, so fetching every one up front would cost far more than the few a user opens.
    let requested = false;
    function load(): void {
        if (requested || !fetchList) return;
        requested = true;
        const ext = row.refExt;
        if (ext === undefined) return;
        fetchList(ext).then(
            (list) => {
                resrefs = list;
            },
            () => {
                // The field keeps working as free text, which is what it is without a game anyway; a failed
                // fetch reaches the user through the bridge's own error channel.
                requested = false;
            },
        );
    }

    const options = $derived(resrefs.map((r) => ({ value: r, label: r })));
    const current = $derived(typeof row.rawValue === "string" ? row.rawValue : (row.displayValue ?? ""));
</script>

<Combobox {options} value={current} onchange={onedit} disabled={!row.editable}
          allowCustom onopen={load} ariaLabel={row.name} />
