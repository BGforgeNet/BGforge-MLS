import { createAbilityEffectsFormatAdapter } from "../ie-common/ability-effects-adapter";
import { rebuildItmCanonicalDocument } from "./canonical";
import {
    buildCanonicalItmJsonSnapshot,
    createCanonicalItmJsonSnapshot,
    loadCanonicalItmJsonSnapshot,
} from "./json-snapshot";
import { itmCompiledPatternFields, itmDomainRanges, itmPresentationSchema } from "./presentation-schema";
import { itmLayout } from "./layout-schema";
import { itmStructureOps, ITM_FIELDS } from "./entity-ops";

export const itmFormatAdapter = createAbilityEffectsFormatAdapter({
    formatId: "itm",
    headerGroup: "ITM Header",
    presentationSchema: itmPresentationSchema,
    compiledPatternFields: itmCompiledPatternFields,
    domainRanges: itmDomainRanges,
    layout: itmLayout,
    fields: ITM_FIELDS,
    snapshot: {
        buildJson: buildCanonicalItmJsonSnapshot,
        createJson: createCanonicalItmJsonSnapshot,
        loadJson: loadCanonicalItmJsonSnapshot,
    },
    rebuildCanonicalDocument: rebuildItmCanonicalDocument,
    ops: itmStructureOps,
});
