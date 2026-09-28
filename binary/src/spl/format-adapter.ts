import { createAbilityEffectsFormatAdapter } from "../ie-common/ability-effects-adapter";
import { rebuildSplCanonicalDocument } from "./canonical";
import {
    buildCanonicalSplJsonSnapshot,
    createCanonicalSplJsonSnapshot,
    loadCanonicalSplJsonSnapshot,
} from "./json-snapshot";
import { splCompiledPatternFields, splDomainRanges, splPresentationSchema } from "./presentation-schema";
import { splLayout } from "./layout-schema";
import { splStructureOps, SPL_FIELDS } from "./entity-ops";

export const splFormatAdapter = createAbilityEffectsFormatAdapter({
    formatId: "spl",
    headerGroup: "SPL Header",
    presentationSchema: splPresentationSchema,
    compiledPatternFields: splCompiledPatternFields,
    domainRanges: splDomainRanges,
    layout: splLayout,
    fields: SPL_FIELDS,
    snapshot: {
        buildJson: buildCanonicalSplJsonSnapshot,
        createJson: createCanonicalSplJsonSnapshot,
        loadJson: loadCanonicalSplJsonSnapshot,
    },
    rebuildCanonicalDocument: rebuildSplCanonicalDocument,
    ops: splStructureOps,
});
