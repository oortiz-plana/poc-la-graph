// Runtime stand-in for `monaco-editor` used only by the test runner.
//
// Monaco needs a real browser layout engine (and its ESM build imports CSS),
// so jsdom tests never load the real editor. This stub supplies the small
// runtime surface the PL/SQL source editor touches directly — the `Range`
// value object used to build evidence-highlight decorations. Type annotations
// still come from the real package at type-check time; Vite only needs this at
// runtime.
export class Range {
  constructor(
    public readonly startLineNumber: number,
    public readonly startColumn: number,
    public readonly endLineNumber: number,
    public readonly endColumn: number,
  ) {}
}
