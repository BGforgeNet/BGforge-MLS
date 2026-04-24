/**
 * D dialog tree builder and registration for WeiDU D and TD dialog preview.
 * Handles both .d files (parsed via tree-sitter) and .td files (transpiled to D
 * then parsed). Uses shared panel infrastructure from ./shared.ts.
 */

import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { escapeHtml, registerDialogPanel, type DialogPreviewController } from "./shared";
import type {
    DDialogData,
    DDialogBlock,
    DDialogBlockKind,
    DDialogState,
    DDialogTransition,
    DDialogTarget,
} from "../../../shared/dialog-types";

// ---------------------------------------------------------------------------
// D-specific helpers
// ---------------------------------------------------------------------------

/** Resolve @123 tra refs, return raw text (not escaped). */
export function getResolvedText(text: string, messages: Record<string, string>): string {
    const traMatch = /^@(\d+)$/.exec(text);
    if (traMatch && traMatch[1]) {
        const resolved = messages[traMatch[1]];
        if (resolved) {
            return resolved;
        }
    }
    return text;
}

/** Returns { plain, html } -- plain is raw (must be escaped before insertion into attributes), html is pre-escaped for display. */
export function getTransitionText(
    t: DDialogTransition,
    messages: Record<string, string>,
): { plain: string; html: string } {
    if (t.replyText) {
        const raw = getResolvedText(t.replyText, messages);
        return { plain: raw, html: escapeHtml(raw) };
    }
    // Silent transitions: show filter icon with trigger as tooltip instead of inline text
    if (t.trigger) {
        return {
            plain: `[${t.trigger}]`,
            html: `<span class="trigger-detail"><span class="codicon codicon-filter" title="${escapeHtml(t.trigger)}"></span></span>`,
        };
    }
    return { plain: "(auto)", html: `<span class="silent-transition">(auto)</span>` };
}

export function renderTargetHtml(target: DDialogTarget): string {
    switch (target.kind) {
        case "goto":
            return `<span class="target-link"><span class="codicon codicon-arrow-right target-arrow"></span> <a href="#" class="node-link" data-target="${escapeHtml(target.label)}">${escapeHtml(target.label)}</a></span>`;
        case "extern":
            return `<span class="target-link"><span class="codicon codicon-arrow-right target-arrow"></span> <span class="extern-marker">[EXTERN] ${escapeHtml(target.file)}:${escapeHtml(target.label)}</span></span>`;
        case "exit":
            return `<span class="target-link"><span class="codicon codicon-stop-circle exit-marker"></span> EXIT</span>`;
        case "copy_trans":
            return `<span class="target-link"><span class="codicon codicon-references"></span> <span class="extern-marker">[COPY_TRANS] ${escapeHtml(target.file)}:${escapeHtml(target.label)}</span></span>`;
    }
}

const STRUCTURAL_KINDS = new Set<DDialogBlockKind>(["begin", "append", "chain", "extend", "interject", "replace"]);

// ---------------------------------------------------------------------------
// Tree builder
// ---------------------------------------------------------------------------

export function buildDTreeHtml(data: DDialogData): string {
    const messages = data.messages ?? {};
    const stateMap = new Map(data.states.map((s) => [s.label, s]));
    const rendered = new Set<string>();
    const minDepth = new Map<string, number>();

    function computeDepths(label: string, depth: number, visited: Set<string>): void {
        if (visited.has(label)) return;
        const currentMin = minDepth.get(label);
        if (currentMin !== undefined && currentMin <= depth) return;
        minDepth.set(label, depth);
        const state = stateMap.get(label);
        if (!state) return;
        visited.add(label);
        for (const t of state.transitions) {
            if (t.target.kind === "goto") {
                computeDepths(t.target.label, depth + 1, visited);
            }
        }
        visited.delete(label);
    }

    function renderState(state: DDialogState, currentDepth: number, defaultSpeaker?: string): string {
        const stateMinDepth = minDepth.get(state.label);

        if (rendered.has(state.label) || (stateMinDepth !== undefined && stateMinDepth < currentDepth)) {
            return `<div class="item node-ref"><span class="codicon codicon-references"></span> <a href="#" class="node-link" data-target="${escapeHtml(state.label)}">${escapeHtml(state.label)}</a></div>`;
        }

        rendered.add(state.label);

        // Separate raw text (for attribute, escaped at insertion) from HTML (for display)
        const sayRaw = state.sayText ? getResolvedText(state.sayText, messages) : "";
        const sayHtml = state.sayText ? escapeHtml(sayRaw) : "";
        // Only show speaker when it differs from the block's file (useful in CHAINs with alternating speakers)
        const speaker = state.speaker;
        const speakerHtml =
            speaker !== undefined && speaker !== defaultSpeaker
                ? ` <span class="speaker-label">[${escapeHtml(speaker)}]</span>`
                : "";
        const sayDisplay = sayHtml
            ? ` <span class="reply msg-text" data-fulltext="${escapeHtml(sayRaw)}">${sayHtml}</span>`
            : "";

        const transitionParts: string[] = [];
        for (const t of state.transitions) {
            const { plain: textPlain, html: textHtml } = getTransitionText(t, messages);
            const targetHtml = renderTargetHtml(t.target);
            const triggerHtml =
                t.trigger && t.replyText
                    ? `<span class="trigger-detail"><span class="codicon codicon-filter" title="${escapeHtml(t.trigger)}"></span></span> `
                    : "";
            const actionHtml = t.action
                ? ` <span class="action-detail"><span class="codicon codicon-play" title="${escapeHtml(t.action)}"></span></span>`
                : "";

            if (t.target.kind === "goto") {
                const targetState = stateMap.get(t.target.label);
                const targetMinDepth = minDepth.get(t.target.label);
                const shouldExpand =
                    targetState && !rendered.has(t.target.label) && targetMinDepth === currentDepth + 1;

                if (shouldExpand) {
                    const childHtml = renderState(targetState, currentDepth + 1, defaultSpeaker);
                    transitionParts.push(`<details open class="option-detail">
                        <summary class="item option option-neutral">${triggerHtml}<span class="codicon codicon-arrow-right"></span> <span class="msg-text" data-fulltext="${escapeHtml(textPlain)}">${textHtml}</span>${actionHtml}${targetHtml}</summary>
                        <div class="children">${childHtml}</div>
                    </details>`);
                } else {
                    transitionParts.push(
                        `<div class="item option option-neutral">${triggerHtml}<span class="codicon codicon-arrow-right"></span> <span class="msg-text" data-fulltext="${escapeHtml(textPlain)}">${textHtml}</span>${actionHtml}${targetHtml}</div>`,
                    );
                }
            } else {
                const icon = t.target.kind === "exit" ? "stop-circle" : "arrow-right";
                transitionParts.push(
                    `<div class="item option option-neutral">${triggerHtml}<span class="codicon codicon-${icon}"></span> <span class="msg-text" data-fulltext="${escapeHtml(textPlain)}">${textHtml}</span>${actionHtml}${targetHtml}</div>`,
                );
            }
        }

        const childrenHtml = transitionParts.join("");

        if (!childrenHtml) {
            return `<div class="item node-inline" id="node-${escapeHtml(state.label)}"><span class="codicon codicon-symbol-function"></span> <span class="node-name">${escapeHtml(state.label)}</span>${speakerHtml}${sayDisplay}</div>`;
        }

        return `<details open class="node" id="node-${escapeHtml(state.label)}">
            <summary><span class="codicon codicon-symbol-function"></span> <span class="node-name">${escapeHtml(state.label)}</span>${speakerHtml}${sayDisplay}</summary>
            <div class="children">${childrenHtml}</div>
        </details>`;
    }

    function renderStructuralBlock(block: DDialogBlock, blockStates: DDialogState[]): string {
        const blockKind = block.kind.toUpperCase();
        const blockTitle = block.label ? `${blockKind} ${escapeHtml(block.label)}` : blockKind;

        for (const state of blockStates) {
            computeDepths(state.label, 1, new Set());
        }

        const stateHtmlParts: string[] = [];
        for (const state of blockStates) {
            if (!rendered.has(state.label)) {
                stateHtmlParts.push(renderState(state, 1, block.file));
            }
        }

        if (stateHtmlParts.length === 0) {
            return "";
        }

        return `<details open class="node">
            <summary><span class="codicon codicon-symbol-event"></span> <span class="block-header">${blockTitle}</span></summary>
            <div class="children">${stateHtmlParts.join("")}</div>
        </details>`;
    }

    function renderModifyBlock(block: DDialogBlock): string {
        const actionName = block.actionName ?? "MODIFY";
        const refsHtml =
            block.stateRefs && block.stateRefs.length > 0
                ? ` ${block.stateRefs.map((ref) => `<a href="#" class="node-link" data-target="${escapeHtml(ref)}">${escapeHtml(ref)}</a>`).join(", ")}`
                : "";
        const desc = block.description ? ` <span class="desc">${escapeHtml(block.description)}</span>` : "";
        return `<div class="item modify-entry"><span class="codicon codicon-edit"></span> <span class="modify-action">${escapeHtml(actionName)}</span>${refsHtml}${desc}</div>`;
    }

    if (data.blocks.length === 0) {
        return "<p>No dialog data found</p>";
    }

    // Group blocks by target file
    const fileOrder: string[] = [];
    const fileBlocks = new Map<string, DDialogBlock[]>();
    for (const block of data.blocks) {
        const existing = fileBlocks.get(block.file);
        if (existing) {
            existing.push(block);
        } else {
            fileOrder.push(block.file);
            fileBlocks.set(block.file, [block]);
        }
    }

    const fileParts: string[] = [];

    for (const file of fileOrder) {
        const blocks = fileBlocks.get(file)!;

        // Partition: structural first, modify second
        const structuralBlocks = blocks.filter((b) => STRUCTURAL_KINDS.has(b.kind));
        const modifyBlocks = blocks.filter((b) => b.kind === "modify");

        const innerParts: string[] = [];

        // Render structural blocks with their states
        for (const block of structuralBlocks) {
            const blockStates = getBlockStates(block, data.states);
            const html = renderStructuralBlock(block, blockStates);
            if (html) {
                innerParts.push(html);
            }
        }

        // Render modify blocks as compact entries
        if (modifyBlocks.length > 0) {
            const modifyHtml = modifyBlocks.map((block) => renderModifyBlock(block)).join("");
            innerParts.push(`<details class="node">
                <summary><span class="codicon codicon-tools"></span> <span class="block-header">Modifications</span> <span class="speaker-label">(${modifyBlocks.length})</span></summary>
                <div class="children">${modifyHtml}</div>
            </details>`);
        }

        if (innerParts.length === 0) {
            continue;
        }

        // Skip file-level grouping when there's only one target file
        if (fileOrder.length === 1) {
            fileParts.push(...innerParts);
        } else {
            fileParts.push(`<details open class="node">
                <summary><span class="codicon codicon-file"></span> <span class="block-header">${escapeHtml(file)}</span></summary>
                <div class="children">${innerParts.join("")}</div>
            </details>`);
        }
    }

    if (fileParts.length === 0) {
        return "<p>No dialog states found</p>";
    }

    return fileParts.join("");
}

// ---------------------------------------------------------------------------
// Block-to-state matching
// ---------------------------------------------------------------------------

export function getBlockStates(block: DDialogBlock, states: DDialogState[]): DDialogState[] {
    if (block.kind === "chain" || block.kind === "interject") {
        return states.filter((s) => s.blockLabel === block.label);
    }
    if (block.kind === "extend") {
        // EXTEND pseudo-states are tagged with blockLabel "extend_{line}"
        const tag = `extend_${block.line}`;
        return states.filter((s) => s.blockLabel === tag);
    }
    // For begin/append/replace: match by speaker and no blockLabel
    return states.filter((s) => s.speaker === block.file && !s.blockLabel);
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerDDialogTree(context: vscode.ExtensionContext, client: LanguageClient): DialogPreviewController {
    return registerDialogPanel(context, client, {
        matchDocument: (doc) => doc.languageId === "weidu-d" || doc.fileName.toLowerCase().endsWith(".td"),
        warningMessage: "Open a D or TD file to preview dialog",
        translationLangId: "weidu-tra",
        buildTreeHtml: (data) => buildDTreeHtml(data as DDialogData),
        hasData: (data) => {
            const d = data as DDialogData;
            return d.blocks.length > 0;
        },
        tabIconPath: "themes/icons/weidu.svg",
    });
}
