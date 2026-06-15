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
    //   (Combobox.Trigger is intentionally NOT used: it toggles `open`, which fought our focus-to-open and
    //    closed the list on click. The chevron is a decorative pointer-events:none span; the input owns opening.)
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

    // inputValue is what the text input shows: the selected label while idle, or the user's search query while
    // typing. We own it; bits-ui does NOT write back (inputValue is not $bindable() in Combobox.Root). `pristine`
    // is true from the moment the list opens until the user actually types: while pristine the input keeps
    // showing the selected value (opening never blanks the field) AND the whole option list is shown (not
    // filtered by the label). The first keystroke flips pristine false and switches to substring filtering.
    // Initialized to literals (not the derived) so $state init does not read a reactive value.
    let inputValue = $state("");
    let pristine = $state(true);
    // The underlying <input> element (bits-ui exposes it via bind:ref). Used to force the displayed value back
    // to the selected label on close - bits-ui leaves its input uncontrolled after a user edit when the list was
    // opened via bind:open (focus), so the controlled inputValue prop alone does not revert a cleared field.
    // eslint-disable-next-line prefer-const -- Svelte's bind:ref assignment is generated; oxlint can't see it.
    let inputEl = $state<HTMLInputElement | null>(null);
    // The scroll viewport (bind:ref). Reset to the top on open / filter so the first item is always visible -
    // otherwise a long list keeps its prior scroll, hiding the top, and bits-ui's "highlight first match" (which
    // only considers items inside the viewport) lands on the first VISIBLE row instead of the real first match.
    // eslint-disable-next-line prefer-const -- Svelte's bind:ref assignment is generated; oxlint can't see it.
    let viewportEl = $state<HTMLElement | null>(null);

    $effect(() => {
        // Re-runs on EVERY open/close transition and on value change: snap the input back to the selected label
        // and reset to pristine. Opening shows the value (the old code blanked it here, which is what made the
        // field look "cleared" on focus); closing discards a half-typed search.
        if (!open) {
            inputValue = selectedLabel;
            pristine = true;
            // Force the DOM directly: the controlled prop is not reliably re-applied after a user edit (above).
            if (inputEl) inputEl.value = selectedLabel;
        }
    });

    // On the rising edge of `open` (however it opened - click, chevron, or keyboard), select the shown value so
    // the first keystroke replaces it and starts a fresh filter instead of appending to the label.
    let wasOpen = false;
    $effect(() => {
        if (open && !wasOpen && inputEl) inputEl.select();
        wasOpen = open;
    });

    // While pristine (just opened / not yet typed) show every option; once the user types, substring-filter.
    const visibleOptions = $derived(pristine ? options : filterOptions(options, inputValue));

    $effect(() => {
        // Re-runs when the list opens (viewport mounts) and whenever the filtered set changes: scroll the list
        // back to the top so the first item / first match is visible rather than scrolled out of view.
        const list = visibleOptions; // tracked: re-run on every filter change
        if (!open || !viewportEl || list.length < 0) return;
        const vp = viewportEl;
        const justOpened = pristine; // captured for the deferred callback below
        vp.scrollTop = 0;
        // On open, bits-ui scrolls the highlighted current value into view AFTER this effect (afterTick), which
        // on a long list lands well down the list. Re-assert the top on the next frame so the list always opens
        // showing the first item.
        requestAnimationFrame(() => {
            if (!open) return;
            vp.scrollTop = 0;
            // On a fresh open bits-ui highlights the current VALUE (now scrolled out of view). Move the highlight
            // to the first item so it is visible AND arrow-down steps from the top instead of jumping to the
            // value. A non-touch pointermove on the row is how bits-ui sets its internal highlighted node. Only
            // on open (pristine); while filtering, bits-ui already highlights the first match correctly.
            if (justOpened) {
                const firstItem = vp.querySelector(".bb-combobox-item");
                firstItem?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
            }
        });
    });

    // items must mirror what is RENDERED (the filtered set), not the full list: bits-ui's "highlight the first
    // match" effect keys on this prop, so handing it the filtered items re-fires highlight-first after every
    // keystroke (and keeps arrow/Enter navigation pointing at on-screen options). Passing the full list left the
    // highlight on an off-screen item, so arrows and Enter did nothing.
    const items = $derived(visibleOptions.map((o) => ({ value: String(o.value), label: o.label })));

    function handleValueChange(next: string): void {
        // bits-ui yields "" by RE-PICKING the current item: type="single" toggles the selection OFF. Never
        // deselect an enum (it always holds a value) - restore the bound value so bits-ui stays in sync, and
        // close, since a re-pick should close the list like any other pick. Number("") is 0, so committing it
        // would also silently set the field to option 0.
        if (next === "") {
            selected = String(value);
            open = false;
            return;
        }
        const num = Number(next);
        if (Number.isFinite(num)) {
            onchange(num);
            // A mouse pick blurs then refocuses the input; that refocus must not reopen the list. Set the flag
            // for that synchronous refocus, then clear it on a microtask so a LATER, genuine focus still opens
            // (a keyboard Enter pick keeps focus and fires no refocus, so the flag must not linger).
            suppressFocusOpen = true;
            queueMicrotask(() => {
                suppressFocusOpen = false;
            });
        }
    }

    // bits-ui refocuses the input after a pick; that focus must NOT reopen the list. handleValueChange sets this
    // flag so the immediately-following focus is ignored once.
    let suppressFocusOpen = false;
    function handleFocus(): void {
        // Focusing the field (Tab or click) opens the list, so the control is fully keyboard-operable without a
        // mouse. Skip the one focus that bits-ui fires right after an item is picked (else it reopens).
        if (suppressFocusOpen) {
            suppressFocusOpen = false;
            return;
        }
        open = true;
    }

    function handleClick(): void {
        // Also open on click so clicking an ALREADY-focused field reopens it - e.g. right after a pick, when the
        // input keeps focus and no focus event fires. Picking an item clicks the portal option, not the input,
        // so this never reopens on selection. Already open -> harmless no-op.
        open = true;
    }

    function handleInput(e: Event): void {
        // The user is now searching: mirror the typed text and switch from pristine (show-all) to filtering.
        inputValue = (e.currentTarget as HTMLInputElement).value;
        pristine = false;
    }

    function handleBlur(): void {
        if (allowCustom) {
            const custom = parseCustomValue(inputValue);
            if (custom !== undefined) {
                onchange(custom);
            }
        }
        // No valid custom value: the $effect restores the selected label when open transitions to false, so the
        // field can never be left blank - clearing the text just reverts to the current value.
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
    <div class="bb-combobox">
        <Combobox.Input
            bind:ref={inputEl}
            class="bb-combobox-input"
            aria-label={ariaLabel}
            title={inputValue || selectedLabel}
            {placeholder}
            onfocus={handleFocus}
            onclick={handleClick}
            oninput={handleInput}
            onblur={handleBlur}
            onkeydown={handleKeydown}
        />
        <!-- The chevron is purely decorative: pointer-events:none (see styles.css) lets a click fall through to
             the input, which owns opening (on focus). A real Combobox.Trigger toggles `open`, which fights the
             focus-to-open and closed the list on click. The input (role=combobox, aria-expanded) carries the a11y. -->
        <span class="bb-combobox-trigger" aria-hidden="true"></span>
    </div>
    <Combobox.Portal>
        <!-- align="start": left-align the list to the input (the anchor), not bits-ui's default center - so the
             dropdown list lines up with the value field instead of being offset. -->
        <Combobox.Content class="bb-combobox-content bb-popup-content" align="start">
            <!-- The Viewport is required for item layout. bits-ui's "highlight first match" filters candidates to
                 those FULLY inside the viewport rect (strict >/<), so the top item must be INSET from the viewport
                 edges or it never highlights - the viewport carries padding (styles.css) to provide that inset.
                 Keyed by query + value so the filtered items REMOUNT each keystroke - bits-ui re-highlights off an
                 item-mount watch, which reused nodes never fire, so the changing key drives the default highlight. -->
            <Combobox.Viewport bind:ref={viewportEl} class="bb-combobox-viewport">
                {#each visibleOptions as opt (inputValue + ":" + opt.value)}
                    <Combobox.Item class="bb-combobox-item bb-popup-item" value={String(opt.value)} label={opt.label}>
                        {opt.label}
                    </Combobox.Item>
                {/each}
            </Combobox.Viewport>
        </Combobox.Content>
    </Combobox.Portal>
</Combobox.Root>
