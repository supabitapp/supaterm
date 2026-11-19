const CUT_LINE_NOTE = / …\[[\d,]+ more characters\]$/;

export function cutLineNote(omittedCharacters: number) {
  return ` …[${omittedCharacters.toLocaleString("en-US")} more characters]`;
}

/** Where a cut line's note starts, past its leading space, or null for a whole line. */
export function cutLineNoteStart(line: string) {
  if (!line.endsWith("more characters]")) return null;
  const note = CUT_LINE_NOTE.exec(line);
  return note === null ? null : note.index + 1;
}

export function hasCutLines(patch: string) {
  return new RegExp(CUT_LINE_NOTE.source, "m").test(patch);
}
