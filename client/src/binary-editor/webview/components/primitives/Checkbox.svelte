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
    }: {
        checked: boolean;
        label: string;
        onchange: (checked: boolean) => void;
        disabled?: boolean;
        ariaLabel?: string;
    } = $props();
</script>

<!-- A <label> wraps both the checkbox button and the visible text so clicking the label text toggles the
     checkbox (native label association). bits-ui renders its own <input type="checkbox"> hidden sibling for
     form semantics; the visible control is the <button role="checkbox"> emitted by Checkbox.Root.
     aria-label on the Root overrides the wrapping label's text for screen readers when provided. -->
<label class="bb-checkbox-label">
    <Checkbox.Root
        class="bb-checkbox-root"
        {checked}
        onCheckedChange={onchange}
        {disabled}
        aria-label={ariaLabel}
    >
        {#snippet children({ checked: isChecked })}
            <!-- CSS-drawn checkmark: bb-checkbox-indicator carries ::after that draws a rotated L-shape
                 when data-state="checked" is present on the Root. Works without any icon font so it renders
                 correctly in both the real webview and the harness (which has no codicon font). -->
            <span class="bb-checkbox-indicator" aria-hidden="true" data-checked={isChecked}></span>
        {/snippet}
    </Checkbox.Root>
    <span class="bb-checkbox-text">{label}</span>
</label>
