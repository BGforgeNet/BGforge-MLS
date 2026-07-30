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

/** The relations between a table's key and the value a field stores. See `keyEncoding` below for each. */
export type IdsKeyEncoding = "swappedWords" | "keyPlusOne";

export type ExternalRef =
    /** Value is a `dialog.tlk` string reference. Stays a signed number; -1 is the format-wide "no string". */
    | { readonly kind: "strref" }
    /**
     * Value is a key into an IDS table. `tables` is an ordered candidate list, most preferred first. A consumer
     * takes every candidate the install actually ships and lets the earlier one win a key they both name, so
     * the order ranks authority rather than selecting a single table. Both halves of that matter in practice:
     * editions disagree on which table exists at all (BG2 names sound slots in SNDSLOT.IDS, BG1 in
     * SOUNDOFF.IDS), and where two do coexist they are often complementary rather than rival - a projectile
     * field's two tables each name keys the other cannot, so taking the first present outright drops whatever
     * only the runner-up covers, however authoritative the leader is.
     */
    | {
          readonly kind: "ids";
          readonly tables: readonly string[];
          /**
           * How the field's stored value encodes a table's key, per table - the same value can be one table's
           * key outright and another's at an offset. A table absent from this map - the usual case - is keyed
           * exactly as the field stores it.
           *
           * `swappedWords` exchanges the two halves of a dword: a CRE kit stores KIT.IDS 0x4003 KENSAI as
           * 0x40030000. It is an involution, so it converts in both directions, and every key stays inside
           * the field - which a shift does not: the EE tables key BARBARIAN as 0x40000000 and WILDMAGE as
           * 0x80000000, and IWD2 keys eight cleric kits above 0x10000, all of which a left-shift pushes off
           * the end of the dword. Declared only on 4-byte fields; it means nothing on a narrower one.
           *
           * `keyPlusOne` means the stored value is the table's key plus one: an ability's projectile stores
           * MISSILE.IDS 2 Arrow, which is PROJECTL.IDS 0x1 ARROW.
           */
          readonly keyEncoding?: Readonly<Record<string, IdsKeyEncoding>>;
          /**
           * A table whose SYMBOLS are resrefs of `type`, so the field's value identifies a real resource and
           * not merely a name - PROJECTL.IDS's symbols are `.PRO` basenames, making a projectile openable.
           *
           * The consumer offers to OPEN that resource; the field stays a numeric named list and never becomes
           * a resref picker. Names the table because a declaration's candidates need not agree: MISSILE.IDS
           * sits beside PROJECTL.IDS and its symbols are labels with no file behind them.
           */
          readonly symbolResource?: { readonly table: string; readonly type: string };
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
