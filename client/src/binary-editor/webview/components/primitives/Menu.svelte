<script lang="ts">
    // Thin wrapper over bits-ui's compound DropdownMenu. The rest of the webview imports THIS, never bits-ui
    // directly (enforced by an oxlint no-restricted-imports rule). Theming lives entirely in styles.css
    // (.bb-menu*, .bb-popup-*); a component <style> block is intentionally avoided because the webview runs
    // under a strict nonce CSP that blocks non-nonced injected <style> tags.
    //
    // Verified against bits-ui@2.15.0 (client/node_modules/bits-ui/dist/bits/dropdown-menu):
    //   DropdownMenu.Root     - shared menu Root (menu.svelte); props: open (bool), onOpenChange, dir.
    //   DropdownMenu.Trigger  - renders a <button>; its children are the visible trigger label/icon.
    //                           Props: disabled (bool|null|undefined). Keyboard: Space/Enter/ArrowDown opens.
    //   DropdownMenu.Portal   - portals the floating content out of the DOM tree (positioned via CSSOM).
    //   DropdownMenu.Content  - the menu surface (dropdown-menu-content.svelte). Props: class, loop,
    //                           preventScroll (bool, default true - sets body.style.pointerEvents:none).
    //                           preventScroll={false}: a row-action menu is not a modal dialog; locking
    //                           body scroll when the menu is open is surprising and unnecessary.
    //   DropdownMenu.Item     - props: disabled (bool), onSelect (event callback), textValue, closeOnSelect.
    //                           Renders as role="menuitem". Keyboard nav (ArrowUp/Down, Enter, Escape) built in.
    //   DropdownMenu.Separator - renders a visual divider (role="separator").
    // No per-item value: items carry string ids; onselect fires with the item id on selection.
    import { DropdownMenu } from "bits-ui";
    import type { Snippet } from "svelte";
    import Icon from "../Icon.svelte";

    export interface MenuItem {
        id: string;
        label: string;
        icon?: string;
        disabled?: boolean;
        danger?: boolean;
    }

    const {
        items,
        onselect,
        ariaLabel,
        trigger,
    }: {
        items: MenuItem[];
        onselect: (id: string) => void;
        ariaLabel?: string;
        trigger?: Snippet;
    } = $props();
</script>

<DropdownMenu.Root>
    <DropdownMenu.Trigger class="bb-menu-trigger" aria-label={ariaLabel ?? "Actions"}>
        {#if trigger}
            {@render trigger()}
        {:else}
            <!-- Default trigger: a three-dot "more actions" icon button. aria-label is set on the
                 Trigger element above (role="button") so the icon glyph stays aria-hidden. -->
            <Icon name="ellipsis" />
        {/if}
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
        <!-- preventScroll={false}: row-action menus are not modal dialogs; body scroll-lock is unnecessary. -->
        <DropdownMenu.Content class="bb-menu-content bb-popup-content" preventScroll={false}>
            {#each items as item (item.id)}
                <DropdownMenu.Item
                    class="bb-menu-item bb-popup-item{item.danger ? ' bb-menu-item-danger' : ''}"
                    disabled={item.disabled ?? false}
                    onSelect={() => onselect(item.id)}
                >
                    {#if item.icon}
                        <Icon name={item.icon} />
                    {/if}
                    {item.label}
                </DropdownMenu.Item>
            {/each}
        </DropdownMenu.Content>
    </DropdownMenu.Portal>
</DropdownMenu.Root>
