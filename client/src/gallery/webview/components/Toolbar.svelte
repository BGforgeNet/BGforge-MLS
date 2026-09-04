<script lang="ts">
    interface Props {
        query: string;
        shown: number;
        total: number;
        title: string;
        onQuery: (value: string) => void;
        /** The tags present in this corpus. Empty hides the control - there is nothing to choose between. */
        tags?: string[];
        tag?: string;
        onTag?: (value: string) => void;
    }

    const { query, shown, total, title, onQuery, tags = [], tag = "", onTag }: Props = $props();

    const display = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);
</script>

<div class="toolbar">
    <input
        type="search"
        placeholder="Filter {title} by name"
        aria-label="Filter by name"
        value={query}
        oninput={(event) => onQuery(event.currentTarget.value)}
    />
    {#if tags.length > 0}
        <select
            class="tagfilter"
            aria-label="Filter by type"
            value={tag}
            onchange={(event) => onTag?.(event.currentTarget.value)}
        >
            <option value="">All types</option>
            {#each tags as option (option)}
                <option value={option}>{display(option)}</option>
            {/each}
        </select>
    {/if}
    <!-- Both numbers, not just the filtered one: "40" alone cannot say whether a search is narrowing a
         thousand items or the gallery only holds forty. -->
    <span class="count">{shown === total ? `${total}` : `${shown} / ${total}`}</span>
</div>
