/**
 * Side-effect module: registers every bundled parser and format adapter, then installs the
 * registry-driven domain-range lookup into `binary-format-contract`. The setter keeps that module
 * cycle-free - derive-zod and the per-format canonical schemas import its codec primitives without
 * dragging in the format-adapter graph.
 *
 * Registration lives here rather than in `format-adapter.ts` because `presentation-schema.ts` reads
 * the adapter registry: registering the concrete formats in that module would put the package root
 * above `pro/` and below it at once, which is the package-root <-> `pro/` import cycle. Anything
 * reaching the registries without going through `index.ts` - a test importing one module directly -
 * imports this file for the same effect.
 */

import { setDomainRangeLookup } from "./binary-format-contract";
import { formatAdapterRegistry } from "./format-adapter";
import { parserRegistry } from "./registry";
import { proParser } from "./pro";
import { mapParser } from "./map";
import { itmParser } from "./itm";
import { splParser } from "./spl";
import { effParser } from "./eff";
import { dlgParser } from "./dlg";
import { creParser } from "./cre";
import { proFormatAdapter } from "./pro/format-adapter";
import { mapFormatAdapter } from "./map/format-adapter";
import { itmFormatAdapter } from "./itm/format-adapter";
import { splFormatAdapter } from "./spl/format-adapter";
import { effFormatAdapter } from "./eff/format-adapter";
import { dlgFormatAdapter } from "./dlg/format-adapter";
import { creFormatAdapter } from "./cre/format-adapter";

parserRegistry.register(proParser);
parserRegistry.register(mapParser);
parserRegistry.register(itmParser);
parserRegistry.register(splParser);
parserRegistry.register(effParser);
parserRegistry.register(dlgParser);
parserRegistry.register(creParser);

formatAdapterRegistry.register(proFormatAdapter);
formatAdapterRegistry.register(mapFormatAdapter);
formatAdapterRegistry.register(itmFormatAdapter);
formatAdapterRegistry.register(splFormatAdapter);
formatAdapterRegistry.register(effFormatAdapter);
formatAdapterRegistry.register(dlgFormatAdapter);
formatAdapterRegistry.register(creFormatAdapter);

setDomainRangeLookup((format, fieldKey) => formatAdapterRegistry.get(format)?.domainRanges?.[fieldKey]);
