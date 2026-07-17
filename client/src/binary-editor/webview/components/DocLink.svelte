<script lang="ts">
    // Micro "?" help marker shown beside a field label when the field carries a `docUrl` (a capped tooltip's
    // "read the full write-up" link, e.g. to the field's IESDP page). Renders nothing without a url. VS Code
    // intercepts external `href` clicks in a webview and opens them in the system browser, so a plain anchor is
    // all that is needed - no host message. Styling lives in the global styles.css (`.doc-link`), like the other
    // .field/.label rules it sits among - a scoped <style> here did not reach the built bundle.
    const { url, description }: { url: string | undefined; description?: string } = $props();
    // The marker's own tooltip repeats the field's capped description (same text the label shows) and adds a
    // hint that clicking opens the full write-up - so hovering the "?" alone says what the field is AND that
    // there is more. Native `title` renders the newlines as line breaks.
    const tip = $derived([description, "Click to see more"].filter(Boolean).join("\n"));
</script>

{#if url}
    <a
        class="doc-link"
        href={url}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Open the full field documentation (opens in browser)"
        title={tip}>?</a>
{/if}
