import { GITHUB_REPOSITORY_URL } from "./site";

const USER_DOCS_SOURCE_URL = `${GITHUB_REPOSITORY_URL}/blob/main/docs/user/`;
const SIBLING_DOC_LINK = /^(?:\.\/)?([a-z0-9-]+)\.md(#.*)?$/;
const PROSE_BLOCK = /^[^#`|>\-*\d<]/;

export function rewriteUserDocHref(href: string): string {
  const sibling = SIBLING_DOC_LINK.exec(href);
  if (sibling) return `/docs/${sibling[1]}${sibling[2] ?? ""}`;
  if (href.startsWith("../")) return new URL(href, USER_DOCS_SOURCE_URL).href;
  return href;
}

interface MarkdownLink {
  readonly url: string;
}

interface MarkdownLinkContext {
  setProperty(node: MarkdownLink, key: "url", value: string): void;
}

const rewriteLink = (node: MarkdownLink, ctx: MarkdownLinkContext) => {
  ctx.setProperty(node, "url", rewriteUserDocHref(node.url));
};

export const userDocLinksPlugin = {
  name: "supaterm-user-doc-links",
  link: rewriteLink,
  definition: rewriteLink,
};

const toPlainText = (markdown: string) =>
  markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function summarizeUserDoc(body: string) {
  const blocks = body.split(/\n\s*\n/).map((block) => block.trim());
  const heading = blocks.find((block) => block.startsWith("# ")) ?? "";
  const lede = blocks.find((block) => PROSE_BLOCK.test(block)) ?? "";
  return { title: heading.slice(2).trim(), description: toPlainText(lede) };
}
