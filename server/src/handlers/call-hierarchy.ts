import type { CallHierarchyItem } from "vscode-languageserver/node";
import { registry } from "../provider-registry";
import { timeHandler } from "../shared/time-handler";
import type { HandlerContext } from "./context";

/**
 * The provider that produced an item, stashed on `CallHierarchyItem.data` at prepare time so the
 * follow-up incoming/outgoing requests (and their expandable result items) route back to it - the
 * protocol hands those requests a bare item, with no document to look the language up from.
 */
interface CallHierarchyData {
    langId: string;
}

function langIdOf(item: CallHierarchyItem): string | null {
    const data = item.data as CallHierarchyData | undefined;
    return data && typeof data.langId === "string" ? data.langId : null;
}

function stamp(item: CallHierarchyItem, langId: string): CallHierarchyItem {
    return { ...item, data: { langId } satisfies CallHierarchyData };
}

export function register(ctx: HandlerContext): void {
    const ch = ctx.connection.languages.callHierarchy;

    ch.onPrepare(
        timeHandler(
            "onPrepareCallHierarchy",
            (params) => {
                const doc = ctx.documents.get(params.textDocument.uri);
                if (!doc) return null;
                const langId = doc.languageId;
                const items = registry.prepareCallHierarchy(
                    langId,
                    doc.getText(),
                    params.position,
                    params.textDocument.uri,
                );
                return items?.map((item) => stamp(item, langId)) ?? null;
            },
            ctx.timingOpts,
        ),
    );

    ch.onIncomingCalls(
        timeHandler(
            "onCallHierarchyIncomingCalls",
            (params) => {
                const langId = langIdOf(params.item);
                if (!langId) return [];
                return registry
                    .incomingCalls(langId, params.item)
                    .map((call) => ({ ...call, from: stamp(call.from, langId) }));
            },
            ctx.timingOpts,
        ),
    );

    ch.onOutgoingCalls(
        timeHandler(
            "onCallHierarchyOutgoingCalls",
            (params) => {
                const langId = langIdOf(params.item);
                if (!langId) return [];
                return registry
                    .outgoingCalls(langId, params.item)
                    .map((call) => ({ ...call, to: stamp(call.to, langId) }));
            },
            ctx.timingOpts,
        ),
    );
}
