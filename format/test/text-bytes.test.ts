/**
 * A file that is not UTF-8 is formatted one character per byte, so its text holds bytes JavaScript calls whitespace:
 * cp866's `а` is 0xA0, which reads as U+00A0. The pure formatters keep them; each input below is already formatted
 * apart from that character, so the result is the input. The tree formatters' cases are in the server's comment probes.
 */

import { describe, expect, it } from "vitest";
import { formatMsg, formatScriptsLst, formatTra } from "@bgforge/format";

const A = String.fromCodePoint(0xa0);

const CASES: [string, (text: string) => { text: string; warning?: string }, string][] = [
    ["tra line comment", formatTra, `// c${A}\n@1 = ~a~\n`],
    ["tra comment after an entry", formatTra, `@1 = ~a~ // c${A}\n`],
    ["msg note", formatMsg, `# c${A}\n{100}{}{a}\n`],
    ["msg audio name", formatMsg, `{100}{snd${A}}{a}\n`],
    ["scripts.lst comment", formatScriptsLst, `AR0100.int    ; Arroyo${A}\r\n`],
    ["scripts.lst metadata", formatScriptsLst, `AR0100.int    ; Arroyo    # local_vars=0${A}\r\n`],
];

describe("a text byte JavaScript calls whitespace stays", () => {
    it.each(CASES)("%s", (_label, format, text) => {
        expect(format(text)).toEqual({ text });
    });
});
