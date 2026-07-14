import { registry } from "../provider-registry";
import { timeHandler } from "../shared/time-handler";
import type { HandlerContext } from "./context";

export function register(ctx: HandlerContext): void {
    ctx.connection.onSelectionRanges(
        timeHandler(
            "onSelectionRanges",
            (params) => {
                const textDoc = ctx.documents.get(params.textDocument.uri);
                if (!textDoc) {
                    return [];
                }
                return registry.selectionRanges(textDoc.languageId, textDoc.getText(), params.positions);
            },
            ctx.timingOpts,
        ),
    );
}
