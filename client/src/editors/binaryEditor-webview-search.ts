export interface SearchContext {
    readonly treeEl: Element;
    readonly ensureChildrenLoaded: (nodeId: string) => void;
    readonly expandLoadedGroupsAndQueueChildren: () => void;
}

export function filterTree(query: string, ctx: SearchContext): void {
    const { treeEl } = ctx;
    const lowerQuery = query.toLowerCase().trim();

    treeEl.querySelectorAll(".highlight").forEach((el) => el.classList.remove("highlight"));

    if (!lowerQuery) {
        treeEl.querySelectorAll(".hidden").forEach((el) => el.classList.remove("hidden"));
        return;
    }

    ctx.expandLoadedGroupsAndQueueChildren();

    treeEl.querySelectorAll(".group, .field").forEach((el) => el.classList.add("hidden"));

    const showWithParents = (el: Element): void => {
        el.classList.remove("hidden");
        let parent = el.parentElement;
        while (parent && parent !== treeEl) {
            if (parent.classList.contains("group")) {
                parent.classList.remove("hidden");
                parent.classList.add("expanded");
                const nodeId = (parent as HTMLElement).dataset.nodeId;
                if (nodeId) {
                    ctx.ensureChildrenLoaded(nodeId);
                }
            }
            if (parent.classList.contains("group-content")) {
                const group = parent.parentElement;
                if (group) {
                    group.classList.remove("hidden");
                    group.classList.add("expanded");
                }
            }
            parent = parent.parentElement;
        }
    };

    treeEl.querySelectorAll(".group-name").forEach((nameEl) => {
        const name = nameEl.textContent?.toLowerCase() ?? "";
        if (name.includes(lowerQuery)) {
            nameEl.classList.add("highlight");
            const group = nameEl.closest(".group");
            if (group) {
                showWithParents(group);
            }
        }
    });

    treeEl.querySelectorAll(".field-name").forEach((nameEl) => {
        const name = nameEl.textContent?.toLowerCase() ?? "";
        if (name.includes(lowerQuery)) {
            nameEl.classList.add("highlight");
            const field = nameEl.closest(".field");
            if (field) {
                showWithParents(field);
            }
        }
    });
}

export function setupSearchInput(searchInput: HTMLInputElement, ctx: SearchContext): void {
    const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
    searchInput.placeholder = isMac ? "Cmd+F or / to search" : "Ctrl+F or / to search";

    let debounceTimer: ReturnType<typeof setTimeout>;
    searchInput.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => filterTree(searchInput.value, ctx), 150);
    });
}

export function setupGlobalKeyboardShortcuts(searchInput: HTMLInputElement | null, ctx: SearchContext): void {
    document.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "f") {
            event.preventDefault();
            searchInput?.focus();
            searchInput?.select();
        }
        if (
            event.key === "/" &&
            !(
                document.activeElement instanceof HTMLInputElement ||
                document.activeElement instanceof HTMLTextAreaElement ||
                document.activeElement instanceof HTMLSelectElement
            )
        ) {
            event.preventDefault();
            searchInput?.focus();
            searchInput?.select();
        }
        if (event.key === "Escape" && document.activeElement === searchInput && searchInput) {
            searchInput.value = "";
            filterTree("", ctx);
            searchInput.blur();
        }
    });
}
