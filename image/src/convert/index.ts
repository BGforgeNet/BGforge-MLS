import { type Animation } from "../model/animation.ts";
import { type LossReport } from "./loss-report.ts";
import { convertToBam } from "./to-bam.ts";
import { convertToFrm } from "./to-frm.ts";

export { convertToBam } from "./to-bam.ts";
export { convertToFrm } from "./to-frm.ts";

// Dispatches to the target-specific converter; each already handles the already-target-format
// no-op case (see convertToBam/convertToFrm).
export function convert(anim: Animation, target: "frm" | "bam"): { animation: Animation; report: LossReport } {
    return target === "frm" ? convertToFrm(anim) : convertToBam(anim);
}
