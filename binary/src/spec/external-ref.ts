/**
 * A field's reference to data living outside the file that holds it.
 *
 * The declaration travels spec -> display tree and stops there. This library never resolves a ref: resolution
 * needs an installed game, and the answer is per-install (mods extend every table, and editions disagree on
 * which one applies). A consumer holding the game resolves it at presentation time, which is also what keeps a
 * parsed record - and its JSON snapshot - identical whether or not a game is open.
 *
 * Lives in its own module because both the spec shapes (`spec/types.ts`) and the parsed display shapes
 * (`../types.ts`) name it; declaring it on either would make one depend on the other.
 */
// Type-only, and deliberately so: `archive/` imports `spec/` for its own record shapes, so a value import here
// would close a cycle. `import type` is erased before any bundler sees it, and naming the flavours keeps a
// `byFlavour` key checked against the real set instead of being an open string.
import type { IeFlavour } from "../archive/game-type";

export type ExternalRef =
    /** Value is a `dialog.tlk` string reference. Stays a signed number; -1 is the format-wide "no string". */
    | { readonly kind: "strref" }
    /**
     * Value is a key into an IDS table. `tables` is an ordered candidate list, most preferred first. The order
     * is not only ranking: it is how a ref resolves across editions that disagree (BG2 names sound slots in
     * SNDSLOT.IDS, BG1 in SOUNDOFF.IDS), since only one of them exists in any given install.
     */
    | {
          readonly kind: "ids";
          readonly tables: readonly string[];
          /**
           * Bits the field's stored value is shifted left by, relative to the table's key. Default 0 - the
           * stored value IS the key, which is the usual case. A CRE kit dword holds the KIT.IDS key in its
           * high word (0x4003 KENSAI is stored 0x40030000), so it declares 16. A consumer must drop any key
           * that overflows the field once shifted, rather than offering a value the field cannot store.
           */
          readonly keyShift?: number;
      }
    /**
     * Value is a row INDEX in a 2DA table, whose row NAME is the identifier (MSCHOOL row 1 is ABJURER). Same
     * candidate-list semantics as `ids`; the kind differs only in which resource the consumer reads, since the
     * two live under different resource types and parse differently.
     */
    | { readonly kind: "2da"; readonly tables: readonly string[] }
    /**
     * Value is a resref naming another resource of type `type`.
     *
     * ONE type, not a candidate list. Unlike `tables`, which resource a field points at does not depend on what
     * the install happens to ship: it follows from the record's version and the game, both of which are known
     * before any lookup. The handful of fields that genuinely differ name the exception per flavour - ITM
     * `replacement` is a replacement ITEM everywhere except PSTEE, which stores a drop SOUND there. Probing
     * candidates by presence instead would silently pick the wrong one wherever both resources exist.
     *
     * Hand-declared, never generated - IESDP records the target only in prose, and inconsistently.
     */
    | {
          readonly kind: "resource";
          readonly type: string;
          /** Flavours whose record stores a different target type. Absent - the common case - means `type` everywhere. */
          readonly byFlavour?: Readonly<Partial<Record<IeFlavour, string>>>;
      }
    /**
     * The field points outside its file, but at a type another field's value selects - so no single type is
     * right and no lookup can be declared. Marked rather than left bare so the absence reads as a decision
     * instead of an oversight, and so a completeness sweep over resref-shaped fields can tell the two apart.
     *
     * A consumer resolves nothing for it: the field renders exactly as an undeclared one.
     */
    | { readonly kind: "deferred"; readonly reason: string };
