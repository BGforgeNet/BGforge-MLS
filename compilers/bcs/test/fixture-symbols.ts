/**
 * The naming tables the differential fixtures are written against.
 *
 * They are hand-written and hold ONLY the rows those fixtures use, copied verbatim from a stock BG:EE's own -
 * a signature invented here would prove the codec agrees with a fiction.
 */

import path from "node:path";
import { readIdsTables } from "./ids-tables";

export const FIXTURE_DIR = path.join(__dirname, "fixtures", "differential");
export const IDS_DIR = path.join(FIXTURE_DIR, "ids");

const tables = readIdsTables(IDS_DIR);

export const SYMBOLS = tables.symbols;
export const COMPILE_SYMBOLS = tables.compileSymbols;
