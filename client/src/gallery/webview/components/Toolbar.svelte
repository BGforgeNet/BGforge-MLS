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
        /** The file formats present, on the same terms: one format alone is not a choice. */
        formats?: string[];
        format?: string;
        onFormat?: (value: string) => void;
    }

    const {
        query,
        shown,
        total,
        title,
        onQuery,
        tags = [],
        tag = "",
        onTag,
        formats = [],
        format = "",
        onFormat,
    }: Props = $props();

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
            class="filterselect typefilter"
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
    {#if formats.length > 1}
        <select
            class="filterselect formatfilter"
            aria-label="Filter by format"
            value={format}
            onchange={(event) => onFormat?.(event.currentTarget.value)}
        >
            <option value="">All formats</option>
            {#each formats as option (option)}
                <option value={option}>{option.toUpperCase()}</option>
            {/each}
        </select>
    {/if}
    <!-- Both numbers, not just the filtered one: "40" alone cannot say whether a search is narrowing a
         thousand items or the gallery only holds forty. -->
    <span class="count">{shown === total ? `${total}` : `${shown} / ${total}`}</span>
</div>
