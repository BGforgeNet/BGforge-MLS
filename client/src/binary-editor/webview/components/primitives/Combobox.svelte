<script lang="ts">
    // Thin wrapper over bits-ui's compound Combobox. The rest of the webview imports THIS, never bits-ui
    // directly (enforced by an oxlint no-restricted-imports rule). Theming lives entirely in styles.css
    // (.bb-combobox*); a component <style> block is intentionally avoided because the webview runs under a
    // strict nonce CSP that blocks non-nonced injected <style> tags.
    //
    // Verified against bits-ui@2.15.0 (client/node_modules/bits-ui/dist/bits/combobox):
    //   Combobox.Root     - props: type="single", bind:value (STRING), onValueChange, bind:open (bool);
    //                       inputValue is NOT declared as $bindable() so bind:inputValue is one-way only.
    //                       bits-ui does NOT auto-filter rendered items; filtering is the wrapper's responsibility.
    //   Combobox.Input    - renders an <input>; internally registers oninput via SelectInputState which sets
    //                       root.opts.inputValue.current and highlights the first candidate. Extra handlers
    //                       (oninput, onblur, onkeydown) are merged via mergeProps - both the internal and our
    //                       handlers fire. We intercept oninput to sync our local inputValue for filtering.
    //   Combobox.Portal   - portals the floating content (positioned via CSSOM, not injected <style>).
    //   Combobox.Content  - the listbox popper (role="listbox"), same component as Select.Content.
    //   Combobox.Viewport - scroll container (same as Select.Viewport; ships its own component <style>).
    //   Combobox.Item     - props: value (STRING), label; renders role="option".
    // bits-ui value is a string; numeric<->string conversion happens at this boundary.
    // bind:open is $bindable() in bits-ui and works two-way.
    // inputValue is not $bindable() in bits-ui, so we track it ourselves via oninput on Combobox.Input.
    import { Combobox } from "bits-ui";
    import { filterOptions, parseCustomValue } from "../../state/controls";

    interface ComboboxOption {
        value: number;
        label: string;
    }

    const {
        options,
        value,
        onchange,
        allowCustom = false,
        disabled = false,
        ariaLabel,
        placeholder,
    }: {
        options: ComboboxOption[];
        value: number;
        onchange: (value: number) => void;
        allowCustom?: boolean;
        disabled?: boolean;
        ariaLabel?: string;
        placeholder?: string;
    } = $props();

    // bits-ui stores the selection as a string; keep a string mirror of the numeric prop. Initialized to a
    // literal (not String(value)) so it does not reference a reactive prop at $state init; the $effect below
    // populates it on mount before first paint.
    let selected = $state("");
    $effect(() => {
        selected = String(value);
    });

    const selectedLabel = $derived(options.find((o) => o.value === value)?.label ?? (allowCustom ? String(value) : ""));

    // open tracks dropdown state. bits-ui declares open as $bindable() so bind:open works two-way.
    // eslint-disable-next-line prefer-const -- Svelte's bind:open assignment is generated; oxlint can't see it.
    let open = $state(false);

    // inputValue is the current search query. We own this state; bits-ui does NOT write back to us (inputValue
    // is not $bindable() in Combobox.Root). We update it via our oninput handler on Combobox.Input (which
    // fires alongside bits-ui's internal handler via mergeProps). On open we clear it; on close we restore it.
    // Initialized to a literal (not selectedLabel) so it does not reference a derived at $state init; the
    // open-tracking $effect below populates it on mount before first paint.
    let inputValue = $state("");

    $effect(() => {
        if (open) {
            // Dropdown just opened: clear the filter so all options are visible initially.
            inputValue = "";
        } else {
            // Dropdown closed: display the selected option's label in the closed input.
            inputValue = selectedLabel;
        }
    });

    // Filter the rendered items based on what the user has typed. $derived tracks inputValue reactively.
    const visibleOptions = $derived(filterOptions(options, inputValue));

    // items is the full (unfiltered) option list for bits-ui typeahead on the closed trigger.
    const items = $derived(options.map((o) => ({ value: String(o.value), label: o.label })));

    function handleValueChange(next: string): void {
        const num = Number(next);
        if (Number.isFinite(num)) {
            onchange(num);
        }
    }

    function handleInput(e: Event): void {
        // Keep our inputValue in sync with what the user typed (bits-ui does not write back via bind).
        inputValue = (e.currentTarget as HTMLInputElement).value;
    }

    function handleBlur(): void {
        if (allowCustom) {
            const custom = parseCustomValue(inputValue);
            if (custom !== undefined) {
                onchange(custom);
            }
        }
        // No valid selection: inputValue will be reset by the $effect when open transitions to false.
    }

    function handleKeydown(e: KeyboardEvent): void {
        if (e.key === "Enter" && allowCustom) {
            const custom = parseCustomValue(inputValue);
            if (custom !== undefined) {
                onchange(custom);
                (e.currentTarget as HTMLInputElement).blur();
            }
        }
    }
</script>

<!-- inputValue guard: when closed, force selectedLabel rather than the local inputValue. This covers the brief
     window after open flips false but before the open-tracking $effect resets inputValue, avoiding a stale frame. -->
<Combobox.Root
    type="single"
    bind:value={selected}
    onValueChange={handleValueChange}
    {disabled}
    {items}
    bind:open
    inputValue={open ? inputValue : selectedLabel}
>
    <Combobox.Input
        class="bb-combobox-input"
        aria-label={ariaLabel}
        {placeholder}
        oninput={handleInput}
        onblur={handleBlur}
        onkeydown={handleKeydown}
    />
    <Combobox.Portal>
        <Combobox.Content class="bb-combobox-content bb-popup-content">
            <Combobox.Viewport class="bb-combobox-viewport">
                {#each visibleOptions as opt (opt.value)}
                    <Combobox.Item class="bb-combobox-item bb-popup-item" value={String(opt.value)} label={opt.label}>
                        {opt.label}
                    </Combobox.Item>
                {/each}
            </Combobox.Viewport>
        </Combobox.Content>
    </Combobox.Portal>
</Combobox.Root>
