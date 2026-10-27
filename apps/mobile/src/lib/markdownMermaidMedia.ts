import { parseNormalizedMarkdown, type MarkdownNode } from "./markdownDocument";

export function markdownMermaidMedia(markdown: string) {
  const sources = new Map<string, string>();
  if (!/(?:`{3,}|~{3,})mermaid\b/i.test(markdown)) return { markdown, sources };
  const edits: Array<{ start: number; end: number; href: string }> = [];
  const visit = (node: MarkdownNode) => {
    if (node.type === "code" && node.lang?.toLowerCase() === "mermaid") {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      const source = markdown.slice(start, end);
      const opening = /^(?<fence>`{3,}|~{3,})/.exec(source)?.groups?.fence;
      const closing = /^(?:[ \t]*>[ \t]?)*[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(
        source.slice(source.lastIndexOf("\n") + 1),
      )?.[1];
      if (!opening || !closing || opening[0] !== closing[0] || closing.length < opening.length)
        return;
      const href = `supaterm-mermaid://block/${sources.size}`;
      sources.set(href, node.value);
      edits.push({ start, end, href });
    } else if ("children" in node) node.children.forEach(visit);
  };
  visit(parseNormalizedMarkdown(markdown));
  for (let index = edits.length - 1; index >= 0; index--) {
    const edit = edits[index]!;
    markdown =
      markdown.slice(0, edit.start) + `![Mermaid](<${edit.href}>)` + markdown.slice(edit.end);
  }
  return { markdown, sources };
}
