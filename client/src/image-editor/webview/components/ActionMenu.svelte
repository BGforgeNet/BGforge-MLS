<script lang="ts">
    import { tick } from "svelte";

    // A shared action-menu dropdown (used by "Save as" and "Import"): a trigger button that opens an
    // upward menu of actions - picking one fires `onselect(value)` and closes. Hand-rolled rather than a
    // native <select> because a native popup always highlights its current value; this opens with nothing
    // highlighted. Toolbar sits at the bottom, so the menu drops upward.
    interface MenuItem {
        value: string;
        label: string;
        title?: string;
    }

    const {
        label,
        ariaLabel,
        items,
        onselect,
    }: {
        label: string;
        ariaLabel: string;
        items: MenuItem[];
        onselect: (value: string) => void;
    } = $props();

    let open = $state(false);
    // eslint-disable-next-line prefer-const -- assigned via bind:this in the markup
    let root = $state<HTMLDivElement>();

    function menuItems(): HTMLButtonElement[] {
        return root ? [...root.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')] : [];
    }
    function focusTrigger(): void {
        root?.querySelector<HTMLButtonElement>(".dropdown-trigger")?.focus();
    }

    function openMenu(focusFirst: boolean): void {
        open = true;
        // Keyboard open (ArrowDown) moves focus into the menu; mouse open leaves nothing highlighted.
        if (focusFirst) void tick().then(() => menuItems()[0]?.focus());
    }
    function closeMenu(refocus: boolean): void {
        open = false;
        if (refocus) focusTrigger();
    }
    function choose(value: string): void {
        closeMenu(false);
        onselect(value);
    }

    function onTriggerKeydown(event: KeyboardEvent): void {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            openMenu(true);
        }
    }
    function onItemKeydown(event: KeyboardEvent): void {
        const list = menuItems();
        const idx = list.indexOf(document.activeElement as HTMLButtonElement);
        if (event.key === "Escape") {
            event.preventDefault();
            closeMenu(true);
        } else if (event.key === "ArrowDown") {
            event.preventDefault();
            list[Math.min(idx + 1, list.length - 1)]?.focus();
        } else if (event.key === "ArrowUp") {
            event.preventDefault();
            list[Math.max(idx - 1, 0)]?.focus();
        } else if (event.key === "Tab") {
            closeMenu(false);
        }
    }
    function onWindowPointerDown(event: PointerEvent): void {
        if (open && root && !root.contains(event.target as Node)) closeMenu(false);
    }
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<div class="dropdown" bind:this={root}>
    <button
        type="button"
        class="dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        onclick={() => (open ? closeMenu(false) : openMenu(false))}
        onkeydown={onTriggerKeydown}
    >
        {label}
    </button>
    {#if open}
        <div class="dropdown-menu" role="menu">
            {#each items as item (item.value)}
                <button
                    type="button"
                    role="menuitem"
                    class="dropdown-item"
                    title={item.title}
                    onclick={() => choose(item.value)}
                    onkeydown={onItemKeydown}
                >
                    {item.label}
                </button>
            {/each}
        </div>
    {/if}
</div>
