import { type Animation } from "../model/animation.ts";
import { type LossReport } from "./loss-report.ts";
import { convertToBam } from "./to-bam.ts";
import { type FrmConvertOpts, convertToFrm } from "./to-frm.ts";

export { convertToBam } from "./to-bam.ts";
export { convertToFrm, frmDirectionMode, type FrmConvertOpts } from "./to-frm.ts";

// Dispatches to the target-specific converter; each already handles the already-target-format no-op
// case. `opts` (palette mode or a single-orientation cycle) forwards to convertToFrm, so a caller can
// convert a non-standard-cycle BAM through the dispatcher; convertToBam takes no options.
export function convert(
    anim: Animation,
    target: "frm" | "bam",
    opts?: FrmConvertOpts,
): { animation: Animation; report: LossReport } {
    return target === "frm" ? convertToFrm(anim, opts) : convertToBam(anim);
}
