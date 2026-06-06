<script lang="ts">
    // Stub: variable-length array section (ITM/CRE lists). The schema specifies it now; the real
    // implementation (delegating to ListSection/InlineList via the windowed getChildren path keyed by
    // sectionKey) lands when the remaining formats migrate (plan follow-up section 12). PRO is form-only
    // and never emits a list block, so this stub is unreachable for the only format using layout today.
    const { sectionKey }: { sectionKey: string } = $props();
</script>
<div class="layout-stub">List section "{sectionKey}" - not yet implemented in the layout renderer.</div>
