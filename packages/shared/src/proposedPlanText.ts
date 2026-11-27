export function proposedPlanTitle(planMarkdown: string): string | null {
  let fence = "";
  for (const line of planMarkdown.split(/\r?\n/)) {
    const [, marker = "", info = ""] = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/) ?? [];
    if (fence) {
      if (marker[0] === fence[0] && marker.length >= fence.length && /^[ \t]*$/.test(info)) {
        fence = "";
      }
      continue;
    }
    // CommonMark: a backtick fence's info string cannot contain a backtick.
    if (marker && (marker[0] !== "`" || !info.includes("`"))) {
      fence = marker;
      continue;
    }
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/)?.[1]?.trim();
    if (heading) return heading;
  }
  return null;
}

export function stripDisplayedPlanMarkdown(planMarkdown: string): string {
  const lines = planMarkdown.trimEnd().split(/\r?\n/);
  let start = lines[0] && /^\s{0,3}#{1,6}\s+/.test(lines[0]) ? 1 : 0;
  while (lines[start]?.trim().length === 0) {
    start += 1;
  }
  const firstHeadingMatch = lines[start]?.match(/^\s{0,3}#{1,6}\s+(.+)$/);
  if (firstHeadingMatch?.[1]?.trim().toLowerCase() === "summary") {
    start += 1;
    while (lines[start]?.trim().length === 0) {
      start += 1;
    }
  }
  return lines.slice(start).join("\n");
}
