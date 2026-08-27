// Curated re-export surface for the conversion layer. Deliberately no `convert(anim, target)`
// dispatcher: its only caller already had to switch on the target to pick a serializer, so the
// wrapper made that one decision twice over two different target vocabularies. Callers name the
// converter they want; see buildCrossFormatSave for the single switch that replaced it.
export { convertToBam } from "./to-bam.ts";
export { convertToFrm, frmDirectionMode, type FrmConvertOpts } from "./to-frm.ts";
export { convertToIndexed, type IndexedConvertOpts } from "./to-indexed.ts";
export { convertToRgba } from "./to-rgba.ts";
export { convertToBamV2, needsFreshPages } from "./to-bamv2.ts";
