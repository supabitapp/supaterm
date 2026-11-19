import { keepOrderedListNumbers, keepsOrderedListNumbers } from "./markdownOrderedListNumbers.ts";

interface MarkdownPosition {
  readonly start?: {
    readonly line?: number;
    readonly offset?: number;
  };
}

interface MarkdownAstNode {
  readonly type: string;
  readonly value?: unknown;
  readonly position?: MarkdownPosition;
  children?: MarkdownAstNode[];
}

interface MarkdownFile {
  readonly value?: unknown;
}

interface MarkdownParser {
  parse(markdown: string): unknown;
}

const INLINE_PARSE_PREFIX = "supaterm-markdown-inline-prefix:";

function isSameLineOverIndentedCode(
  node: MarkdownAstNode,
  parent: MarkdownAstNode | undefined,
  markdown: string,
) {
  if (
    node.type !== "code" ||
    parent?.type !== "listItem" ||
    typeof node.value !== "string" ||
    !/^[\t ]/.test(node.value)
  ) {
    return false;
  }

  const nodeStart = node.position?.start;
  const parentStart = parent.position?.start;
  if (
    nodeStart?.line === undefined ||
    nodeStart.offset === undefined ||
    parentStart?.line === undefined ||
    nodeStart.line !== parentStart.line
  ) {
    return false;
  }

  const sourceCharacter = markdown[nodeStart.offset];
  return sourceCharacter !== "`" && sourceCharacter !== "~";
}

function parseRecoveredMarkdown(value: string, parser: MarkdownParser) {
  const source = `${INLINE_PARSE_PREFIX}${value}`;
  const document = parser.parse(source) as MarkdownAstNode;
  const blocks = document.children;
  const paragraph = blocks?.[0];
  const children = paragraph?.type === "paragraph" ? paragraph.children : undefined;
  const first = children?.[0];
  if (
    !blocks ||
    !children ||
    first?.type !== "text" ||
    typeof first.value !== "string" ||
    !first.value.startsWith(INLINE_PARSE_PREFIX)
  ) {
    return { blocks: [{ type: "text", value }], source };
  }

  const firstValue = first.value.slice(INLINE_PARSE_PREFIX.length);
  return {
    blocks: [
      {
        ...paragraph,
        type: "paragraph",
        children: [...(firstValue ? [{ ...first, value: firstValue }] : []), ...children.slice(1)],
      },
      ...blocks.slice(1),
    ],
    source,
  };
}

function blocksFromIndentedCode(node: MarkdownAstNode, parser: MarkdownParser) {
  const value = typeof node.value === "string" ? node.value.trim() : "";
  const recovered = parseRecoveredMarkdown(value, parser);
  if (keepsOrderedListNumbers(parser)) {
    for (const block of recovered.blocks) keepOrderedListNumbers(block, recovered.source);
  }
  const first = recovered.blocks[0];
  return {
    ...recovered,
    blocks:
      first && node.position
        ? [{ ...first, position: node.position }, ...recovered.blocks.slice(1)]
        : recovered.blocks,
  };
}

function attachListItemIndentationNormalizer(this: MarkdownParser) {
  return (tree: MarkdownAstNode, file: MarkdownFile) => {
    if (typeof file.value !== "string") {
      return;
    }
    const markdown = file.value;

    const visit = (node: MarkdownAstNode, source: string) => {
      if (!node.children) {
        return;
      }
      if (!node.children.some((child) => isSameLineOverIndentedCode(child, node, source))) {
        for (const child of node.children) visit(child, source);
        return;
      }
      node.children = node.children.flatMap((child) => {
        if (isSameLineOverIndentedCode(child, node, source)) {
          const recovered = blocksFromIndentedCode(child, this);
          for (const block of recovered.blocks) {
            visit(block, recovered.source);
          }
          return recovered.blocks;
        }
        visit(child, source);
        return [child];
      });
    };

    visit(tree, markdown);
  };
}

export const remarkNormalizeListItemIndentation = attachListItemIndentationNormalizer;
