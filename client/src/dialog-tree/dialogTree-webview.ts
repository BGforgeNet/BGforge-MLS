// Dialog tree webview script (SSL, D, TD, TSSL).
// Wrapped in IIFE to avoid global scope conflicts with other webview scripts.
// Shares patterns with ../editors/binaryEditor-webview.ts:
//   - Platform-aware search placeholder (isMac detection)
//   - Keyboard shortcuts (Ctrl+F / Escape)
//   - Expand/collapse all button handlers
// Each has its own escapeHtml copy (separate esbuild bundle, can't share imports).
(function () {
    // @ts-expect-error -- acquireVsCodeApi is injected by VSCode webview runtime
    const vscode = acquireVsCodeApi();

    // Escape HTML for safe interpolation into innerHTML.
    // Values read from DOM properties (.id, .textContent) are browser-decoded,
    // so they must be re-escaped before insertion into innerHTML strings.
    function escapeHtml(text: string): string {
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    // Simple debounce helper
    function debounce<T extends (..._args: unknown[]) => void>(fn: T, ms: number): T {
        let timeout: ReturnType<typeof setTimeout>;
        return ((...args: unknown[]) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), ms);
        }) as T;
    }

    // Align .msg-text widths within each sibling group so action icons and targets line up.
    // Sets flex-basis to the widest sibling's natural width (scrollWidth).
    // flex-basis (not min-width) allows graceful shrinking when the container is narrow.
    // Uses three-pass approach (reset → measure → apply) to avoid layout thrashing.
    function alignSiblingMsgTexts(): void {
        // Collect groups: each group is the sibling .msg-text elements within one .children container
        const groups: HTMLElement[][] = [];
        document.querySelectorAll(".children").forEach((container) => {
            const msgTexts: HTMLElement[] = [];
            for (const child of Array.from(container.children)) {
                let msgText: HTMLElement | null = null;
                if (child.classList.contains("item")) {
                    msgText = child.querySelector(".msg-text");
                } else if (child.tagName === "DETAILS") {
                    const summary = child.querySelector(":scope > summary");
                    if (summary) {
                        msgText = summary.querySelector(".msg-text");
                    }
                }
                if (msgText) {
                    msgTexts.push(msgText);
                }
            }
            if (msgTexts.length >= 2) {
                groups.push(msgTexts);
            }
        });

        // Pass 1: Reset all flex-basis (batch writes)
        for (const group of groups) {
            for (const el of group) {
                el.style.flexBasis = "";
            }
        }

        // Pass 2: Measure max width per group (batch reads -- single reflow)
        const maxWidths: number[] = [];
        for (const group of groups) {
            let maxWidth = 0;
            for (const el of group) {
                maxWidth = Math.max(maxWidth, el.scrollWidth);
            }
            maxWidths.push(maxWidth);
        }

        // Pass 3: Apply flex-basis per group (batch writes)
        for (let i = 0; i < groups.length; i++) {
            // Safe: groups and maxWidths are built in lockstep
            const width = maxWidths[i]!;
            for (const el of groups[i]!) {
                el.style.flexBasis = width + "px";
            }
        }
    }

    // Update tooltips only for overflowing text
    function updateOverflowTooltips(): void {
        document.querySelectorAll(".msg-text[data-fulltext]").forEach((el) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.scrollWidth > htmlEl.clientWidth) {
                htmlEl.title = htmlEl.dataset.fulltext || "";
            } else {
                htmlEl.removeAttribute("title");
            }
        });
    }

    // Select an element - removes previous selection and highlights new one
    function selectElement(el: Element): void {
        document.querySelectorAll(".selected").forEach((e) => e.classList.remove("selected"));
        el.classList.add("selected");
    }

    // Get required DOM elements (null check ensures they exist before cast)
    const searchInputEl = document.getElementById("search");
    const searchResultsEl = document.querySelector(".search-results");
    const treeEl = document.querySelector(".tree");
    const expandAllBtn = document.getElementById("expandAll");
    const collapseAllBtn = document.getElementById("collapseAll");

    if (searchInputEl === null || searchResultsEl === null || treeEl === null || expandAllBtn === null || collapseAllBtn === null) {
        throw new Error("Required DOM elements not found");
    }
    const searchInput = searchInputEl as HTMLInputElement;
    const searchResults = searchResultsEl as HTMLElement;
    const tree = treeEl as HTMLElement;
    const sidebar = document.querySelector<HTMLElement>(".sidebar");
    let fatalErrorShown = false;

    function showFatalError(message: string, error?: unknown): void {
        if (fatalErrorShown) {
            return;
        }
        fatalErrorShown = true;

        const detail = error instanceof Error
            ? `${message}\n${error.stack ?? error.message}`
            : message;
        console.error("Dialog preview runtime error:", error ?? message);
        vscode.postMessage({
            type: "runtimeError",
            message,
            stack: error instanceof Error ? error.stack : undefined,
        });

        const existing = document.querySelector(".errors");
        existing?.remove();

        const wrapper = document.createElement("div");
        wrapper.className = "errors";
        const line = document.createElement("div");
        line.textContent = detail;
        wrapper.append(line);

        tree.replaceChildren();
        tree.classList.remove("hidden");
        tree.parentElement?.insertBefore(wrapper, tree);
        searchResults.classList.add("hidden");
        searchResults.innerHTML = "";
        sidebar?.classList.add("hidden");
    }

    window.addEventListener("error", (event) => {
        showFatalError(event.message || "Unhandled dialog preview error", event.error);
    });

    window.addEventListener("unhandledrejection", (event) => {
        const reason = event.reason;
        const message = reason instanceof Error ? reason.message : String(reason);
        showFatalError(message || "Unhandled dialog preview promise rejection", reason);
    });

    // Set platform-aware search placeholder
    const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent);
    searchInput.placeholder = isMac ? "Cmd+F or / to search" : "Ctrl+F or / to search";

    interface SearchResult {
        type: "node" | "item";
        name?: string;
        id?: string;
        text?: string;
        msgText?: string;
        parentName?: string;
        parentId?: string;
    }

    // Search functionality - shows flat results list, hides tree
    function filterTree(query: string): void {
        const lowerQuery = query.toLowerCase().trim();

        // If empty query, show tree, hide results
        if (!lowerQuery) {
            searchResults.classList.add("hidden");
            searchResults.innerHTML = "";
            tree.classList.remove("hidden");
            return;
        }

        // Hide tree, show results
        tree.classList.add("hidden");
        searchResults.classList.remove("hidden");

        const results: SearchResult[] = [];

        // Find matching node names (first occurrences have id="node-XXX")
        document.querySelectorAll('[id^="node-"]').forEach((nodeEl) => {
            const nodeName = nodeEl.id.replace("node-", "");
            if (nodeName.toLowerCase().includes(lowerQuery)) {
                results.push({ type: "node", name: nodeName, id: nodeEl.id });
            }
        });

        // Find matching replies/options by text content and attributes
        document.querySelectorAll(".item.reply, .item.option, summary.option").forEach((itemEl) => {
            // Element.textContent is always string at runtime (never null for elements)
            const textContent = itemEl.textContent!;
            // Also search in title attributes (contains type/msgId like "NLowOption(873)")
            const titles = Array.from(itemEl.querySelectorAll("[title]")).map(el => el.getAttribute("title") || "").join(" ");
            const fullText = textContent + " " + titles;
            if (fullText.toLowerCase().includes(lowerQuery)) {
                // Find parent node name
                const parentNode = itemEl.closest('[id^="node-"]');
                const parentName = parentNode ? parentNode.id.replace("node-", "") : "";
                // Store msg-text for navigation matching
                const msgTextEl = itemEl.querySelector(".msg-text");
                const msgText = msgTextEl ? msgTextEl.textContent!.trim() : "";
                // Build display text including the type from title
                const typeTitle = itemEl.querySelector(".codicon[title]")?.getAttribute("title") || "";
                const displayText = typeTitle ? `${typeTitle}: ${textContent.trim()}` : textContent.trim();
                results.push({ type: "item", text: displayText, parentName: parentName, parentId: parentNode?.id, msgText });
            }
        });

        // Find matching inline text on node summaries (first reply/say text shown inline with the node name).
        // Uses direct child selector (>) to avoid hitting option summaries already covered above.
        document.querySelectorAll("details.node > summary .msg-text[data-fulltext]").forEach((msgTextEl) => {
            const htmlEl = msgTextEl as HTMLElement;
            const fulltext = htmlEl.dataset.fulltext || "";
            if (!fulltext.toLowerCase().includes(lowerQuery)) return;

            const nodeEl = msgTextEl.closest('[id^="node-"]');
            const nodeName = nodeEl ? nodeEl.id.replace("node-", "") : "";
            const summary = msgTextEl.closest("summary");
            if (!summary) return; // Structurally guaranteed by selector, but guard defensively
            const typeTitle = summary.querySelector(".codicon[title]")?.getAttribute("title") || "";
            // For D dialog say text (no typeTitle), check .reply class to preserve reply color in results
            const isReply = msgTextEl.classList.contains("reply");
            const displayText = typeTitle
                ? `${typeTitle}: ${fulltext}`
                : isReply ? `Reply: ${fulltext}` : fulltext;

            results.push({ type: "item", text: displayText, parentName: nodeName, parentId: nodeEl?.id, msgText: htmlEl.textContent!.trim() });
        });

        // Render flat results - store item text in data-text for finding the specific item.
        // All values are re-escaped because DOM properties (.id, .textContent) decode HTML entities.
        searchResults.innerHTML = results
            .map((r) => {
                if (r.type === "node") {
                    return `<div class="result" data-target="${escapeHtml(r.id ?? "")}">`
                        + `<span class="codicon codicon-symbol-method"></span> `
                        + `<span class="node-name">${escapeHtml(r.name ?? "")}</span></div>`;
                } else {
                    const prefix = r.parentName ? `<span class="desc">${escapeHtml(r.parentName)}:</span> ` : "";
                    const text = r.text ?? "";
                    // Determine color class from option type prefix (G=good, B=bad, N=neutral)
                    let cls = "option";
                    if (text.startsWith("Reply")) {
                        cls = "reply";
                    } else if (text.startsWith("G")) {
                        cls = "option-good";
                    } else if (text.startsWith("B")) {
                        cls = "option-bad";
                    } else {
                        cls = "option-neutral";
                    }
                    return `<div class="result" data-target="${escapeHtml(r.parentId ?? "")}" data-text="${escapeHtml(r.msgText ?? "")}">`
                        + `${prefix}<span class="${cls}">${escapeHtml(text)}</span></div>`;
                }
            })
            .join("");
    }

    function clearSearch(scrollTarget?: Element): void {
        if (searchInput.value) {
            searchInput.value = "";
            filterTree("");
            // Scroll to target after restoring tree
            if (scrollTarget) {
                scrollTarget.scrollIntoView({ block: "center" });
            }
        }
    }

    // Navigate to a node: expand parents, scroll, select
    // If itemText is provided, find and select the specific reply/option within the node
    function navigateToNode(targetId: string, itemText?: string): void {
        const targetEl = document.getElementById(targetId);
        if (targetEl) {
            // Expand all parent <details> elements to make target visible
            let parent = targetEl.parentElement;
            while (parent) {
                if (parent.tagName === "DETAILS") {
                    (parent as HTMLDetailsElement).open = true;
                }
                parent = parent.parentElement;
            }
            // Also expand the target node itself
            if (targetEl.tagName === "DETAILS") {
                (targetEl as HTMLDetailsElement).open = true;
            }

            // Find the specific item within the node if itemText is provided
            let elementToSelect: Element | null = null;
            if (itemText) {
                // Search for the specific reply/option by message text content
                const items = Array.from(targetEl.querySelectorAll(".item.reply, .item.option, summary.option"));
                for (const item of items) {
                    const msgTextEl = item.querySelector(".msg-text");
                    const msgText = msgTextEl ? msgTextEl.textContent!.trim() : undefined;
                    if (msgText === itemText) {
                        elementToSelect = item;
                        break;
                    }
                }
            }

            // Fall back to the node summary, or the node itself if inline
            if (elementToSelect === null) {
                elementToSelect = targetEl.querySelector("summary") ?? targetEl;
            }

            elementToSelect.scrollIntoView({ block: "center" });
            selectElement(elementToSelect);
        }
    }

    document.body.addEventListener("click", (e) => {
        const target = e.target as Element;

        // Handle clicks on "(see above)" links that reference other nodes
        const link = target.closest(".node-link") as HTMLElement | null;
        if (link) {
            e.preventDefault();
            // stopPropagation prevents VSCode webview from jumping to top on link click
            e.stopPropagation();
            clearSearch();

            const targetId = "node-" + link.dataset.target;
            navigateToNode(targetId);
            return;
        }

        // Handle clicks on search results - navigate to node/item in tree
        const result = target.closest(".search-results .result") as HTMLElement | null;
        if (result) {
            const targetId = result.dataset.target;
            const itemText = result.dataset.text; // Text of specific reply/option to select
            // Clear search first to show tree
            searchInput.value = "";
            filterTree("");
            if (targetId) {
                navigateToNode(targetId, itemText);
            }
            return;
        }

        // Handle regular clicks on tree items - select and clear search
        const item = target.closest("summary, .item");
        if (item) {
            selectElement(item);
            clearSearch(item);
        }
    });

    // Toolbar buttons
    expandAllBtn.addEventListener("click", () => {
        document.querySelectorAll("details").forEach((d) => (d.open = true));
        alignSiblingMsgTexts();
        updateOverflowTooltips();
    });

    collapseAllBtn.addEventListener("click", () => {
        document.querySelectorAll("details").forEach((d) => (d.open = false));
    });

    // Debounced search to avoid lag on large dialogs
    const debouncedFilter = debounce(() => filterTree(searchInput.value), 150);
    searchInput.addEventListener("input", debouncedFilter);

    // Update alignment and tooltips when details are toggled
    document.addEventListener("toggle", (e) => {
        if ((e.target as HTMLElement).tagName === "DETAILS") {
            alignSiblingMsgTexts();
            updateOverflowTooltips();
        }
    }, true);

    // Ctrl+F or / focuses search, Escape clears
    document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "f") {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
        // "/" focuses search (vim-style) when not already typing in an input/textarea
        if (e.key === "/" && !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
            e.preventDefault();
            searchInput.focus();
            searchInput.select();
        }
        if (e.key === "Escape" && document.activeElement === searchInput) {
            clearSearch();
            searchInput.blur();
        }
    });

    // Align text and update tooltips on load and resize
    alignSiblingMsgTexts();
    updateOverflowTooltips();
    window.addEventListener("resize", () => {
        alignSiblingMsgTexts();
        updateOverflowTooltips();
    });
})();
