/**
 * SSL dialog tree builder and registration for Fallout SSL dialog preview.
 * Uses shared panel infrastructure from ./shared.ts.
 */

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { escapeHtml, registerDialogPanel, type DialogPreviewController } from "./shared";

// ---------------------------------------------------------------------------
// Data model (duplicated from server/src/dialog.ts -- can't cross-import)
// ---------------------------------------------------------------------------

interface DialogReply {
    msgId: number | string;
    line: number;
}

export interface DialogOption {
    msgId: number | string;
    target: string;
    type: string;
    line: number;
}

export interface DialogNode {
    name: string;
    line: number;
    replies: DialogReply[];
    options: DialogOption[];
    callTargets: string[];
}

export interface DialogData {
    nodes: DialogNode[];
    entryPoints: string[];
    messages: Record<string, string>;
}

// ---------------------------------------------------------------------------
// SSL-specific helpers
// ---------------------------------------------------------------------------

/** Resolve msgId to raw text (not escaped). Used for attribute values. */
export function getMsgTextRaw(msgId: number | string, messages: Record<string, string>): string {
    if (typeof msgId === "string") {
        return msgId;
    }
    const text = messages[String(msgId)];
    return text ?? `(${msgId})`;
}

/** Resolve msgId to HTML-escaped text. Used for element content. */
export function getMsgText(msgId: number | string, messages: Record<string, string>): string {
    return escapeHtml(getMsgTextRaw(msgId, messages));
}

interface OptionMeta {
    colorClass: string;
    tooltip: string;
    lowEmoji: string;
    icon: string;
}

export function getOptionMeta(o: DialogOption): OptionMeta {
    const isMessage = o.type.endsWith("Message");
    const colorClass = o.type.startsWith("G") ? "option-good" : o.type.startsWith("B") ? "option-bad" : "option-neutral";
    const tooltip = escapeHtml(`${o.type}(${o.msgId})`);
    const isLow = o.type.includes("Low");
    const lowEmoji = isLow ? `<span title="${tooltip}">🤪</span>` : "";
    const icon = isMessage ? "stop-circle" : "arrow-right";
    return { colorClass, tooltip, lowEmoji, icon };
}

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

export function buildTreeHtml(data: DialogData): string {
    const nodeMap = new Map(data.nodes.map((n) => [n.name, n]));
    const messages = data.messages;

    // Entry points called from talk_p_proc
    const entryPointNames = data.entryPoints.filter((name) => name.startsWith("Node"));
    const entries = entryPointNames
        .map((name) => nodeMap.get(name))
        .filter((n): n is DialogNode => n !== undefined);

    // First pass: compute minimum depth for each node (closest to root wins)
    const minDepth = new Map<string, number>();

    function computeDepths(nodeName: string, depth: number, path: Set<string>): void {
        if (path.has(nodeName)) return; // cycle detection

        const currentMin = minDepth.get(nodeName);
        if (currentMin !== undefined && currentMin <= depth) return;

        minDepth.set(nodeName, depth);

        const node = nodeMap.get(nodeName);
        if (!node) return;

        path.add(nodeName);

        for (const o of node.options) {
            if (o.target && nodeMap.has(o.target)) {
                computeDepths(o.target, depth + 1, path);
            }
        }
        for (const t of node.callTargets) {
            if (nodeMap.has(t)) {
                computeDepths(t, depth + 1, path);
            }
        }

        path.delete(nodeName);
    }

    // Compute depths starting from entry points at depth 1
    for (const name of entryPointNames) {
        computeDepths(name, 1, new Set());
    }

    // Second pass: render tree
    const rendered = new Set<string>();

    const renderNode = (node: DialogNode, currentDepth: number): string => {
        const nodeMinDepth = minDepth.get(node.name);

        // Show link if: already rendered, or this node should appear at a shallower level
        if (rendered.has(node.name) || (nodeMinDepth !== undefined && nodeMinDepth < currentDepth)) {
            return `<div class="item node-ref"><span class="codicon codicon-references"></span> <a href="#" class="node-link" data-target="${escapeHtml(node.name)}">${escapeHtml(node.name)}</a></div>`;
        }

        rendered.add(node.name);

        // If node only has call targets (no replies/options), show inline
        if (node.replies.length === 0 && node.options.length === 0 && node.callTargets.length > 0) {
            const targets = node.callTargets.map((t) => {
                const escaped = escapeHtml(t);
                const targetNode = nodeMap.get(t);
                return targetNode
                    ? `<a href="#" class="node-link" data-target="${escaped}">${escaped}</a>`
                    : `<span class="target">${escaped}</span>`;
            }).join(", ");
            return `<div class="item node-transition" id="node-${escapeHtml(node.name)}"><span class="codicon codicon-symbol-function"></span> <span class="node-name">${escapeHtml(node.name)}</span><span class="target-link"><span class="codicon codicon-arrow-right target-arrow"></span> ${targets}</span></div>`;
        }

        // Find first item to show inline (reply or terminal message)
        let inlineHtml = "";
        let skipFirstReply = false;
        let skipFirstTerminalOption = -1; // index of terminal option to skip

        if (node.replies.length > 0) {
            // First reply goes inline
            // Safe: length check above guarantees index 0 exists
            const r = node.replies[0]!;
            const attr = escapeHtml(getMsgTextRaw(r.msgId, messages));
            const text = getMsgText(r.msgId, messages);
            inlineHtml = `<span class="codicon codicon-comment reply" title="${escapeHtml(`Reply(${r.msgId})`)}"></span> <span class="reply msg-text" data-fulltext="${attr}">${text}</span>`;
            skipFirstReply = true;
        } else {
            // Check for terminal message (option without target)
            const terminalIdx = node.options.findIndex((o) => !o.target);
            if (terminalIdx !== -1) {
                // Safe: findIndex returned valid index
                const o = node.options[terminalIdx]!;
                const { colorClass, tooltip, lowEmoji } = getOptionMeta(o);
                const attr = escapeHtml(getMsgTextRaw(o.msgId, messages));
                const text = getMsgText(o.msgId, messages);
                inlineHtml = `<span class="codicon codicon-stop-circle ${colorClass}" title="${tooltip}"></span>${lowEmoji} <span class="msg-text" data-fulltext="${attr}">${text}</span>`;
                skipFirstTerminalOption = terminalIdx;
            }
        }

        // Build remaining replies (skip first if shown inline)
        const replies = node.replies
            .slice(skipFirstReply ? 1 : 0)
            .map((r) => {
                const attr = escapeHtml(getMsgTextRaw(r.msgId, messages));
                const text = getMsgText(r.msgId, messages);
                return `<div class="item reply"><span class="codicon codicon-comment" title="${escapeHtml(`Reply(${r.msgId})`)}"></span> <span class="msg-text" data-fulltext="${attr}">${text}</span></div>`;
            })
            .join("");

        // Build options (skip terminal if shown inline)
        const optionParts: string[] = [];
        node.options.forEach((o, i) => {
            if (i === skipFirstTerminalOption) return;

            const { colorClass, tooltip, lowEmoji, icon } = getOptionMeta(o);
            const attr = escapeHtml(getMsgTextRaw(o.msgId, messages));
            const text = getMsgText(o.msgId, messages);

            if (o.target) {
                const targetNode = nodeMap.get(o.target);
                const targetMinDepth = minDepth.get(o.target);
                const shouldRenderChild = targetNode && !rendered.has(o.target) && targetMinDepth === currentDepth + 1;
                const escapedTarget = escapeHtml(o.target);
                const targetHtml = targetNode
                    ? `<a href="#" class="node-link" data-target="${escapedTarget}">${escapedTarget}</a>`
                    : `<span class="target">${escapedTarget}</span>`;

                if (shouldRenderChild) {
                    // Render option as expandable with target as child
                    const childHtml = renderNode(targetNode, currentDepth + 1);
                    optionParts.push(`<details open class="option-detail">
                        <summary class="item option ${colorClass}"><span class="codicon codicon-${icon}" title="${tooltip}"></span>${lowEmoji} <span class="msg-text" data-fulltext="${attr}">${text}</span><span class="target-link"><span class="codicon codicon-arrow-right target-arrow"></span> ${targetHtml}</span></summary>
                        <div class="children">${childHtml}</div>
                    </details>`);
                } else {
                    // Just a link, no nested content
                    optionParts.push(`<div class="item option ${colorClass}"><span class="codicon codicon-${icon}" title="${tooltip}"></span>${lowEmoji} <span class="msg-text" data-fulltext="${attr}">${text}</span><span class="target-link"><span class="codicon codicon-arrow-right target-arrow"></span> ${targetHtml}</span></div>`);
                }
            } else {
                optionParts.push(`<div class="item option ${colorClass}"><span class="codicon codicon-${icon}" title="${tooltip}"></span>${lowEmoji} <span class="msg-text" data-fulltext="${attr}">${text}</span></div>`);
            }
        });
        const options = optionParts.join("");

        const children = replies + options;

        // If no children remain, render as single line
        if (!children) {
            return `<div class="item node-inline" id="node-${escapeHtml(node.name)}"><span class="codicon codicon-symbol-function"></span> <span class="node-name">${escapeHtml(node.name)}</span> ${inlineHtml}</div>`;
        }

        return `<details open class="node" id="node-${escapeHtml(node.name)}">
            <summary><span class="codicon codicon-symbol-function"></span> <span class="node-name">${escapeHtml(node.name)}</span> ${inlineHtml}</summary>
            <div class="children">${children}</div>
        </details>`;
    };

    if (entries.length === 0) return "<p>No dialog nodes found</p>";

    const entryHtml = entries.map((node) => renderNode(node, 1)).join("");

    return `<details open class="node">
        <summary><span class="codicon codicon-symbol-event"></span> <span class="node-name">talk_p_proc</span></summary>
        <div class="children">${entryHtml}</div>
    </details>`;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDialogTree(context: vscode.ExtensionContext, client: LanguageClient): DialogPreviewController {
    return registerDialogPanel(context, client, {
        matchDocument: (doc) =>
            doc.languageId === "fallout-ssl" ||
            doc.fileName.toLowerCase().endsWith(".tssl"),
        warningMessage: "Open a Fallout SSL or TSSL file to preview dialog",
        translationLangId: "fallout-msg",
        buildTreeHtml: (data) => buildTreeHtml(data as DialogData),
        hasData: (data) => {
            const d = data as DialogData;
            return d.nodes.length > 0;
        },
        tabIconPath: "themes/icons/fallout-ssl.svg",
    });
}
