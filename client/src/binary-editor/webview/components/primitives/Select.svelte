<script lang="ts">
    // Thin wrapper over bits-ui's compound Select. The rest of the webview imports THIS, never bits-ui
    // directly (enforced by an oxlint no-restricted-imports rule). Theming lives entirely in styles.css
    // (.bb-select*); a component <style> block is intentionally avoided because the webview runs under a
    // strict nonce CSP that blocks non-nonced injected <style> tags.
    //
    // Verified against bits-ui@2.15.0 (client/node_modules/bits-ui/dist/bits/select):
    //   Select.Root     - props: type="single", bind:value (STRING), onValueChange, disabled, items, name.
    //   Select.Trigger  - renders a <button>; its children are the visible label.
    //   Select.Portal   - portals the floating content (positioned via CSSOM, not injected <style>).
    //   Select.Content  - the listbox popper (role="listbox").
    //   Select.Viewport - scroll container (NOTE: ships its own component <style> for scrollbar hiding).
    //   Select.Item     - props: value (STRING), label; renders role="option".
    // bits-ui's value is a string, so we convert at this boundary: numeric value <-> string.
    import { Select } from "bits-ui";

    interface SelectOption {
        value: number;
        label: string;
    }

    const {
        options,
        value,
        onchange,
        disabled = false,
        ariaLabel,
    }: {
        options: SelectOption[];
        value: number;
        onchange: (value: number) => void;
        disabled?: boolean;
        ariaLabel?: string;
    } = $props();

    // bits-ui stores the selection as a string; keep a string mirror of the numeric prop.
    let selected = $state(String(value));
    $effect(() => {
        selected = String(value);
    });

    const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? "");
    // items powers bits-ui typeahead and form autofill; mirror our options as {value,label} strings.
    const items = $derived(options.map((o) => ({ value: String(o.value), label: o.label })));

    function handleValueChange(next: string): void {
        const num = Number(next);
        if (Number.isFinite(num)) onchange(num);
    }
</script>

<Select.Root type="single" bind:value={selected} onValueChange={handleValueChange} {disabled} {items}>
    <Select.Trigger class="bb-select-trigger" aria-label={ariaLabel}>
        {selectedLabel}
    </Select.Trigger>
    <Select.Portal>
        <Select.Content class="bb-select-content">
            <Select.Viewport class="bb-select-viewport">
                {#each options as opt (opt.value)}
                    <Select.Item class="bb-select-item" value={String(opt.value)} label={opt.label}>
                        {opt.label}
                    </Select.Item>
                {/each}
            </Select.Viewport>
        </Select.Content>
    </Select.Portal>
</Select.Root>
