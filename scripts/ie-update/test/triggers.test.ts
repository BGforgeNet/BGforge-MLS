/**
 * Tests for IESDP trigger extraction from HTML pages.
 */

import { describe, expect, it } from "vitest";
import { extractTriggersFromHtml } from "../src/ie/triggers.ts";

const BASE_URL = "https://gibberlings3.github.io/iesdp/scripting/triggers/bgeetriggers.htm";

describe("extractTriggersFromHtml", () => {
    it("extracts trigger signatures and multiline docs from HTML", () => {
        const html = `
<div class="title_main"> BG2: ToB Script Triggers </div>
<br />
<strong>0x0001 Acquired(S:ResRef*)</strong><br />
NT Returns true only if the current CRE obtained the specified item in the last script round.<br />
Trigger appears to be broken?<br />
<br />
<strong>0x4023 True()</strong><br />
Always returns true.<br />
<br />
`;

        const result = extractTriggersFromHtml(html, BASE_URL);

        expect(result).toEqual([
            {
                name: "Acquired",
                detail: "Acquired(S:ResRef*)",
                doc: "NT Returns true only if the current CRE obtained the specified item in the last script round.\nTrigger appears to be broken?",
            },
            {
                name: "True",
                detail: "True()",
                doc: "Always returns true.",
            },
        ]);
    });

    it("converts links and code tags to markdown", () => {
        const html = `
<div class="triggerHeader"><a name="0x002F">0x002F Heard(O:Object*,I:ID*SHOUTIDS)</a></div>
<div class="indent1">
Returns true only if the active
<a href="../../file_formats/ie_formats/cre_v1.htm"><code>CRE</code></a>
was within shouting range
(see <a href="../../scripting/actions/bgeeactions.htm#106"><code>Shout</code></a>).<br />
</div>
<br />
`;

        const [result] = extractTriggersFromHtml(html, BASE_URL);

        expect(result).toBeDefined();
        expect(result!.name).toBe("Heard");
        expect(result!.detail).toBe("Heard(O:Object*,I:ID*SHOUTIDS)");
        expect(result!.doc).toContain("[CRE](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/cre_v1.htm)");
        expect(result!.doc).toContain(
            "[Shout](https://gibberlings3.github.io/iesdp/scripting/actions/bgeeactions.htm#106)",
        );
    });

    it("does not wrap markdown links in backticks when source uses code around anchors", () => {
        const html = `
<div class="triggerHeader"><a name="0x4047">0x4047 RandomNum(I:Range*,I:Value*)</a></div>
<div class="indent1">
Scripting uses the same random value to seed all <code><a href="#0x4047">RandomNum()</a></code> triggers across a single tick.
</div>
<br />
`;

        const [result] = extractTriggersFromHtml(html, BASE_URL);

        expect(result).toBeDefined();
        expect(result!.doc).toContain(
            "[RandomNum()](https://gibberlings3.github.io/iesdp/scripting/triggers/bgeetriggers.htm#0x4047)",
        );
        expect(result!.doc).not.toContain("`[RandomNum()]");
    });

    it("normalizes Liquid-style hrefs before resolving them", () => {
        const html = `
<div class="triggerHeader"><a name="0x002F">0x002F Heard(O:Object*,I:ID*SHOUTIDS)</a></div>
<div class="indent1">
See <a href="{{ '/file_formats/ie_formats/cre_v1.htm' | prepend: relurl }}"><code>CRE</code></a> and
<a href="{{ '/scripting/actions/bgeeactions.htm#106' | prepend: relurl }}"><code>Shout</code></a>.
</div>
<br />
`;

        const [result] = extractTriggersFromHtml(html, BASE_URL);

        expect(result).toBeDefined();
        expect(result!.doc).toContain("[CRE](https://gibberlings3.github.io/iesdp/file_formats/ie_formats/cre_v1.htm)");
        expect(result!.doc).toContain(
            "[Shout](https://gibberlings3.github.io/iesdp/scripting/actions/bgeeactions.htm#106)",
        );
        expect(result!.doc).not.toContain("%7B%7B");
    });

    it("extracts BGEE-only triggers from the EE trigger page structure", () => {
        const html = `
<div class="triggerHeader"><a name="0x40DE">0x40DE HasDLC(S:DLCName*)</a></div>
<div class="indent1">
Returns true if the DLC is available.
</div>
<br />
<div class="triggerHeader"><a name="0x4103">0x4103 CheckItemSlot(O:Object*,S:Item*,I:Slot*SLOTS)</a></div>
<div class="indent1">
Returns true if the specified item is equipped in the specified slot.
</div>
<br />
`;

        const result = extractTriggersFromHtml(html, BASE_URL);

        expect(result.map((item) => item.name)).toEqual(["HasDLC", "CheckItemSlot"]);
    });

    it("skips reserved placeholder triggers", () => {
        const html = `
<div class="triggerHeader"><a name="0x40EE">0x40EE reserved1()</a></div>
<div class="indent1">Reserved.</div>
<br />
<div class="triggerHeader"><a name="0x40C5">0x40C5 XPLT(O:Object*,I:XP)</a></div>
<div class="indent1">Returns true if XP is lower than the specified value.</div>
<br />
<div class="triggerHeader"><a name="0x4105">0x4105 reserved()</a></div>
<div class="indent1">Reserved.</div>
<br />
`;

        const result = extractTriggersFromHtml(html, BASE_URL);

        expect(result.map((item) => item.name)).toEqual(["XPLT"]);
    });

    it("preserves aliases that share a single documentation block", () => {
        const html = `
<div class="triggerHeader"><a name="0x4031">0x4031 HaveSpell(I:Spell*Spell)</a></div>
<div class="triggerHeader"><a name="0x4031">0x4031 HaveSpellRES(S:Spell*)</a></div>
<div class="indent1">
Returns true only if the active CRE has the specified spell memorised.
</div>
<br />
<div class="triggerHeader"><a name="0x0091">0x0091 SpellCast(O:Object*,I:Spell*Spell)</a></div>
<div class="triggerHeader"><a name="0x0091">0x0091 SpellCastRES(S:Spell*,O:Object*)</a></div>
<div class="indent1">
Returns true only if the specified object cast the specified spell.
</div>
<br />
`;

        const result = extractTriggersFromHtml(html, BASE_URL);

        expect(result.map((item) => item.name)).toEqual(["HaveSpell", "HaveSpellRES", "SpellCast", "SpellCastRES"]);
        expect(result[0]!.doc).toBe("Returns true only if the active CRE has the specified spell memorised.");
        expect(result[1]!.doc).toBe("Returns true only if the active CRE has the specified spell memorised.");
        expect(result[2]!.doc).toBe("Returns true only if the specified object cast the specified spell.");
        expect(result[3]!.doc).toBe("Returns true only if the specified object cast the specified spell.");
    });

    it("decodes common HTML entities used in trigger docs", () => {
        const html = `
<div class="triggerHeader"><a name="0x9999">0x9999 EntityTest()</a></div>
<div class="indent1">
Only for door scripts &mdash; returns true for 1&frasl;15th seconds and 0 &longrightarrow; FOO.
</div>
<br />
`;

        const [result] = extractTriggersFromHtml(html, BASE_URL);

        expect(result).toBeDefined();
        expect(result!.doc).toContain("Only for door scripts - returns true for 1/15th seconds and 0 -> FOO.");
        expect(result!.doc).not.toContain("&mdash;");
        expect(result!.doc).not.toContain("&frasl;");
        expect(result!.doc).not.toContain("&longrightarrow;");
    });
});
