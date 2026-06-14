<script lang="ts">
    // Thin wrapper over bits-ui's Checkbox.Root. The rest of the webview imports THIS, never bits-ui
    // directly (enforced by an oxlint no-restricted-imports rule). Theming lives entirely in styles.css
    // (.bb-checkbox*); a component <style> block is intentionally avoided because the webview runs under a
    // strict nonce CSP that blocks non-nonced injected <style> tags.
    //
    // Verified against bits-ui@2.15.0 (client/node_modules/bits-ui/dist/bits/checkbox):
    //   Checkbox.Root  - renders a <button role="checkbox">; props: checked ($bindable bool, default false),
    //                    onCheckedChange (callback), disabled, indeterminate, readonly, name, value, type.
    //                    Exposes data-state="checked"|"unchecked"|"indeterminate" on the root button.
    //                    Its children snippet receives { checked: boolean, indeterminate: boolean } snippet
    //                    props - we render our CSS checkmark indicator inside that snippet.
    //   CheckboxInput  - rendered automatically by Checkbox.Root as a sibling hidden input for form use.
    //                    No separate import needed.
    // No Checkbox.Indicator compound exists; indicator rendering is the consumer's responsibility inside
    // the children snippet. We draw the mark with a CSS ::after pseudo-element keyed on data-state.
    import { Checkbox } from "bits-ui";

    const {
        checked,
        label,
        onchange,
        disabled = false,
        ariaLabel,
        title,
    }: {
        checked: boolean;
        label: string;
        onchange: (checked: boolean) => void;
        disabled?: boolean;
        ariaLabel?: string;
        /** Hover tooltip on the whole control (label + box). */
        title?: string;
    } = $props();
</script>

<!-- A <label> wraps both the checkbox button and the visible text so clicking the label text toggles the
     checkbox (native label association). bits-ui renders its own <input type="checkbox"> hidden sibling for
     form semantics; the visible control is the <button role="checkbox"> emitted by Checkbox.Root.
     <label> provides click-target coupling but NOT an accessible name to a <button> (only labelable elements
     like <input> are named by <label>). The button's accessible name therefore comes from aria-label. We
     default to the visible `label` prop so screen readers announce the same text that is visible; pass
     `ariaLabel` explicitly only when a different announcement is needed (e.g. to add units or extra context). -->
<label class="bb-checkbox-label" {title}>
    <Checkbox.Root
        class="bb-checkbox-root"
        {checked}
        onCheckedChange={onchange}
        {disabled}
        aria-label={ariaLabel ?? label}
    >
        {#snippet children({ checked: isChecked })}
            <!-- CSS-drawn checkmark: bb-checkbox-indicator carries ::after that draws a rotated L-shape
                 when data-state="checked" is present on the Root. Works without any icon font so it renders
                 correctly in both the real webview and the harness (which has no codicon font). -->
            <span class="bb-checkbox-indicator" aria-hidden="true" data-checked={isChecked}></span>
        {/snippet}
    </Checkbox.Root>
    {#if label}<span class="bb-checkbox-text">{label}</span>{/if}
</label>
