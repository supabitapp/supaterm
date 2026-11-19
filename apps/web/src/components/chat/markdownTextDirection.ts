import { textDirection } from "~/textDirection";

type HastNode = {
  type?: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const BLOCK_TAGS = new Set([
  "blockquote",
  "br",
  "details",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "li",
  "ol",
  "p",
  "summary",
  "table",
  "td",
  "th",
  "tr",
  "ul",
]);

function proseText(node: HastNode): string;
function proseText(node: HastNode) {
  if (node.type === "text") return (node.value ?? "") satisfies string;
  if (node.tagName === "code") return " " satisfies string;
  const text = (node.children ?? []).map(proseText).join("");
  return (node.tagName && BLOCK_TAGS.has(node.tagName) ? ` ${text} ` : text) satisfies string;
}

function isolateInlineCode(node: HastNode) {
  if (node.tagName === "pre") return;
  if (node.tagName === "code") {
    node.properties = { ...node.properties, dir: "ltr" };
    return;
  }
  node.children?.forEach(isolateInlineCode);
}

/**
 * Gives each top-level block the direction of its own words, so an Arabic or
 * Hebrew reply reads right to left beside English ones. Lines inside a list or
 * quote follow it, keeping markers and rules on one side. Inline code is left
 * out of the count and isolated left to right, so its punctuation stays put.
 */
export function rehypeTextDirection() {
  return (tree: HastNode) => {
    for (const block of tree.children ?? []) {
      if (block.type !== "element" || block.tagName === "pre") continue;
      const dir = textDirection(proseText(block));
      if (dir) block.properties = { ...block.properties, dir };
    }
    isolateInlineCode(tree);
  };
}
