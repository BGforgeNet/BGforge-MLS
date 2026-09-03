<script lang="ts">
    interface Props {
        query: string;
        shown: number;
        total: number;
        title: string;
        onQuery: (value: string) => void;
    }

    const { query, shown, total, title, onQuery }: Props = $props();
</script>

<div class="toolbar">
    <input
        type="search"
        placeholder="Filter {title} by name"
        aria-label="Filter by name"
        value={query}
        oninput={(event) => onQuery(event.currentTarget.value)}
    />
    <!-- Both numbers, not just the filtered one: "40" alone cannot say whether a search is narrowing a
         thousand items or the gallery only holds forty. -->
    <span class="count">{shown === total ? `${total}` : `${shown} / ${total}`}</span>
</div>
