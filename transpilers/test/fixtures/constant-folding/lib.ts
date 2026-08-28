/**
 * The imported half of the constant-folding fixture: an enum member and a plain const, both used in
 * arithmetic by the two entries beside this file.
 *
 * Imported rather than declared locally on purpose. `optimization.inlineConst: false` keeps an imported
 * binding from becoming a literal in the bundle, so this is the case no bundler optimiser folds and the
 * transpiler's own pass has to handle.
 */

export enum Lib {
    Base = 10,
}

export const OFFSET = 5;
