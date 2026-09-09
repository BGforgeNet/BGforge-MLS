<script lang="ts">
    // Thin wrapper over bits-ui's compound Dialog, matching Menu.svelte beside it. The rest of the webview
    // imports THIS, never bits-ui directly (enforced by an oxlint no-restricted-imports rule). Theming lives
    // entirely in primitives.css (.bb-dialog-*), which every panel mounting this control links; a component
    // <style> block is intentionally avoided because the webview runs under a strict nonce CSP that blocks
    // non-nonced injected <style> tags.
    //
    // Verified against bits-ui@2.15.0 (client/node_modules/bits-ui/dist/bits/dialog):
    //   Dialog.Root      - props: open (bool), onOpenChange, onOpenChangeComplete.
    //   Dialog.Portal    - portals the content out of the DOM tree.
    //   Dialog.Overlay   - the backdrop; a presence layer, so it renders only while open.
    //   Dialog.Content   - the panel. Focus scope, escape layer and dismissible layer are built in, so
    //                      Escape and a click outside both close it without wiring here.
    //   Dialog.Title     - the accessible name, associated with Content by the library.
    //
    // No Trigger: this dialog is opened by a control that lives elsewhere (a toolbar button), so `open` is
    // bound by the caller rather than driven by a trigger the wrapper would have to place.
    import { Dialog } from "bits-ui";
    import type { Snippet } from "svelte";

    // `let`, not `const`: a $bindable prop is written through by the caller's binding.
    // eslint-disable-next-line prefer-const -- bound by the caller via bind:open
    let {
        open = $bindable(false),
        title,
        body,
        footer,
    }: {
        open: boolean;
        /** The accessible name, and the panel's heading. */
        title: string;
        body: Snippet;
        /** The dialog's actions, laid out along its trailing edge. */
        footer?: Snippet;
    } = $props();
</script>

<Dialog.Root bind:open>
    <Dialog.Portal>
        <Dialog.Overlay class="bb-dialog-overlay" />
        <!-- preventScroll={false}, as the Menu wrapper does and for the same reason: the scroll lock sets
             `pointer-events: none` on the body, and here it did not come back off - closing the dialog left
             the whole webview inert, which a drive caught by being unable to click anything afterwards. A
             webview panel does not scroll its body anyway (the editor's own layout owns scrolling), so the
             lock buys nothing; the overlay below is what makes this modal. -->
        <Dialog.Content class="bb-dialog bb-popup-content" preventScroll={false}>
            <Dialog.Title class="bb-dialog-title">{title}</Dialog.Title>
            <div class="bb-dialog-body">
                {@render body()}
            </div>
            {#if footer}
                <div class="bb-dialog-footer">
                    {@render footer()}
                </div>
            {/if}
        </Dialog.Content>
    </Dialog.Portal>
</Dialog.Root>
