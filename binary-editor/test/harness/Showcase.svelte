<script lang="ts">
    // Minimal showcase for the primitives spike: renders the Select wrapper with sample options so the
    // Playwright driver can open it under the real strict CSP and assert no CSP violation occurs.
    import Select from "../../../client/src/binary-editor/webview/components/primitives/Select.svelte";

    const options = [
        { value: 0, label: "None" },
        { value: 1, label: "Fire" },
        { value: 2, label: "Cold" },
        { value: 3, label: "Lightning" },
    ];
    let current = $state(1);
</script>

<div class="showcase-root">
    <Select {options} value={current} ariaLabel="Element" onchange={(v) => (current = v)} />
</div>
