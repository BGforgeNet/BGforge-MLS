<script lang="ts">
    import { codiconClass } from "./icon-name";
    // When this icon is the sole content of an interactive control (button, link, etc.),
    // the control itself must carry an accessible label (aria-label or visually-hidden text).
    // This component stays aria-hidden so screen readers skip the raw glyph span.
    const { name, title }: { name: string; title?: string } = $props();
</script>
<span class={codiconClass(name)} aria-hidden="true" {title}></span>
