import { type Animation, type Facing } from "../model/animation.ts";
import { type LossReport } from "./loss-report.ts";
import { convertToBam } from "./to-bam.ts";
import { convertToFrm } from "./to-frm.ts";

export { convertToBam } from "./to-bam.ts";
export { convertToFrm } from "./to-frm.ts";

// Dispatches to the target-specific converter; each already handles the already-target-format no-op
// case. `opts` (e.g. an explicit direction layout) forwards to convertToFrm, so a caller can convert
// a non-standard-cycle BAM through the dispatcher; convertToBam takes no options.
export function convert(
    anim: Animation,
    target: "frm" | "bam",
    opts?: { layout?: Facing[]; paletteMode?: "sidecar" | "nearest" },
): { animation: Animation; report: LossReport } {
    return target === "frm" ? convertToFrm(anim, opts) : convertToBam(anim);
}
