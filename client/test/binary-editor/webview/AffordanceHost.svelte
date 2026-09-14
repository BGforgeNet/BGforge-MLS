<script lang="ts" generics="P extends Record<string, unknown>">
    // Test host: provides the handlers LayoutRenderer provides in the real panel, so a block renderer mounted
    // alone draws every affordance (each one renders nothing without its handler).
    import type { Component } from "svelte";
    import { provideJump } from "../../../src/binary-editor/webview/state/jump-context";
    import { provideOpenAnimation } from "../../../src/binary-editor/webview/state/open-animation-context";
    import { provideOpenResource } from "../../../src/binary-editor/webview/state/open-resource-context";
    import { provideThumbnail } from "../../../src/binary-editor/webview/state/thumbnail-context";

    const { component: Inner, props }: { component: Component<P>; props: P } = $props();
    provideJump(() => undefined);
    provideOpenResource(() => undefined);
    provideOpenAnimation(() => undefined);
    provideThumbnail(() => Promise.resolve(undefined));
</script>
<Inner {...props} />
