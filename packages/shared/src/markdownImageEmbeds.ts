import type { Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import { parseFileUrlHref } from "./fileLinks.ts";
import { safeDecodeURIComponent } from "./markdownLinks.ts";
import { isUncPath, isWindowsAbsolutePath, stripSlashPrefixedWindowsDrive } from "./path.ts";
import { remarkKeepWindowsPathDestinations } from "./markdownWindowsPaths.ts";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkKeepWindowsPathDestinations);

interface ImageNode {
  readonly type: string;
  readonly url?: string;
  readonly identifier?: string;
  readonly children?: ReadonlyArray<ImageNode>;
}

function imagePathKey(value: string): string {
  const path = stripSlashPrefixedWindowsDrive(value);
  return isWindowsAbsolutePath(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
}

function imageDestination(path: string): string {
  const normalized = isWindowsAbsolutePath(path) ? path.replaceAll("\\", "/") : path;
  const destination = isUncPath(path) ? `file:${normalized}` : normalized;
  return encodeURI(destination).replace(/[?#&]/g, encodeURIComponent);
}

// An unclosed fence or raw HTML block swallows the rest of the reply. Only a root-level block
// can swallow appended embeds; nested ones end with their container.
function unclosedBlockEnd(text: string, tree: Root): string | undefined {
  const last = tree.children.at(-1);
  const source = text.slice(last?.position?.start.offset, last?.position?.end.offset);
  if (last?.type === "html") {
    const tag = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i.exec(source)?.[1];
    if (tag !== undefined) {
      return /<\/(?:script|pre|style|textarea)>/i.test(source) ? undefined : `</${tag}>`;
    }
    return /^ {0,3}<!--/.test(source) && !source.includes("-->") ? "-->" : undefined;
  }
  if (last?.type !== "code") return undefined;
  const fence = /^ {0,3}(`{3,}|~{3,})/.exec(source)?.[1];
  if (fence === undefined) return undefined;
  const lines = source.split(/\r\n|\r|\n/);
  const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(lines.at(-1) ?? "")?.[1];
  const closed =
    lines.length > 1 &&
    closing !== undefined &&
    closing[0] === fence[0] &&
    closing.length >= fence.length;
  return closed ? undefined : fence;
}

export function appendMissingImageEmbeds(text: string, paths: Iterable<string>): string {
  const embedded = new Set<string>();
  let tree: Root | undefined;
  if (text.includes("![")) {
    tree = parser.parse(text);
    const definitions = new Map<string, string>();
    const images: ImageNode[] = [];
    const visit = (node: ImageNode) => {
      if (node.type === "definition" && node.identifier && node.url) {
        if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
      } else if (node.type === "image" || node.type === "imageReference") {
        images.push(node);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
    for (const image of images) {
      const href = image.url ?? definitions.get(image.identifier ?? "");
      if (href) {
        embedded.add(imagePathKey(safeDecodeURIComponent(parseFileUrlHref(href)?.path ?? href)));
      }
    }
  }
  const missing: string[] = [];
  for (const path of paths) {
    const key = imagePathKey(path);
    if (embedded.has(key)) continue;
    embedded.add(key);
    missing.push(`![](<${imageDestination(path)}>)`);
  }
  if (missing.length === 0) return text;
  if (text.length === 0) return missing.join("\n\n");
  const end = unclosedBlockEnd(text, tree ?? parser.parse(text));
  const closed = end === undefined ? text : `${text}${/[\r\n]$/.test(text) ? "" : "\n"}${end}`;
  return [closed, ...missing].join("\n\n");
}
