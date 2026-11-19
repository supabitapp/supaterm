import { UNFINISHED_DRIVE_PATH } from "@supaterm/shared/markdownWindowsPaths";

const SKIPPED_TAGS = new Set(["BUTTON", "INPUT", "SCRIPT", "STYLE", "TEMPLATE"]);
const SKIPPED_CLASS_NAMES = ["select-none", "sr-only"];
const SANITIZED_HTML_SELECTOR = [
  "button",
  "input",
  "script",
  "style",
  "svg",
  '[aria-hidden="true"]',
  ...SKIPPED_CLASS_NAMES.map((className) => `.${className}`),
].join(", ");

const ALERT_ATTRIBUTE = "data-markdown-alert";
const ALERT_LABEL = "data-markdown-alert-label";

export interface MarkdownClipboardPayload {
  text: string;
  html: string;
}

function isSkippedElement(element: Element) {
  if (SKIPPED_TAGS.has(element.tagName) || element.localName === "svg") return true;
  if (element.getAttribute("aria-hidden") === "true") return true;
  return SKIPPED_CLASS_NAMES.some((className) => element.classList.contains(className));
}

function wrapInlineMarker(content: string, marker: string) {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(content);
  const core = match?.[2] ?? "";
  if (!core) return content;
  return `${match?.[1] ?? ""}${marker}${core}${marker}${match?.[3] ?? ""}`;
}

function isBlockCodeElement(element: Element, content: string) {
  if (content.includes("\n")) return true;
  for (const child of element.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).classList.contains("line")) {
      return true;
    }
  }
  return false;
}

function wrapInlineCode(code: string) {
  const longestRun = [...(code.match(/`+/g) ?? [])].reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = "`".repeat(Math.max(1, longestRun + (longestRun > 0 ? 1 : 0)));
  const spaceEdges = code.startsWith(" ") && code.endsWith(" ") && /[^ ]/.test(code);
  const pad = spaceEdges || code.startsWith("`") || code.endsWith("`") ? " " : "";
  return `${fence}${pad}${code}${pad}${fence}`;
}

function codeFenceFor(code: string) {
  const longestRun = [...(code.match(/`{3,}/g) ?? [])].reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  return "`".repeat(Math.max(3, longestRun + 1));
}

export function serializeCodeBlockToMarkdown(source: string, language: string | null) {
  const code = source.replace(/\n$/, "");
  const fence = codeFenceFor(code);
  return `${fence}${language ?? ""}\n${code}\n${fence}\n\n`;
}

const CODE_BOUNDARY = "\u0000";

function verbatimBlock(code: string) {
  return `${CODE_BOUNDARY}${code}${CODE_BOUNDARY}\n\n`;
}

function outsideCode(markdown: string, tidy: (prose: string) => string) {
  return markdown
    .split(CODE_BOUNDARY)
    .map((part, index) =>
      index % 2 === 1 ? `${CODE_BOUNDARY}${part}${CODE_BOUNDARY}` : tidy(part),
    )
    .join("");
}

function serializeCodeBlock(pre: Element) {
  return verbatimBlock((pre.textContent ?? "").replace(/\n$/, ""));
}

function serializeTableCell(cell: Element) {
  return serializeChildren(cell, true).replace(/\n+/g, " ").trim();
}

function tableSeparatorFor(headerCells: Element[]) {
  const markers = headerCells.map((cell) => {
    const align = (cell as HTMLElement).style?.textAlign ?? cell.getAttribute("align") ?? "";
    if (align === "center") return ":---:";
    if (align === "right") return "---:";
    return "---";
  });
  return `| ${markers.join(" | ")} |`;
}

function serializeTable(table: Element) {
  const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
  if (rows.length === 0) return "";
  const lines: string[] = [];
  let emittedSeparator = false;
  for (const row of rows) {
    const cells = [...row.children].filter(
      (cell) => cell.tagName === "TH" || cell.tagName === "TD",
    );
    if (cells.length === 0) continue;
    lines.push(`| ${cells.map((cell) => serializeTableCell(cell)).join(" | ")} |`);
    if (!emittedSeparator) {
      lines.push(tableSeparatorFor(cells));
      emittedSeparator = true;
    }
  }
  return `${lines.join("\n")}\n\n`;
}

function serializeListItem(item: Element, ordered: boolean, index: number, inTableCell: boolean) {
  const checkbox = item.querySelector(
    ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]',
  );
  const task = checkbox ? `[${(checkbox as HTMLInputElement).checked ? "x" : " "}] ` : "";
  const bullet = ordered ? `${index}. ` : "- ";
  const marker = `${bullet}${task}`;
  let content = outsideCode(serializeChildren(item, inTableCell), (prose) =>
    prose.replace(/\n{3,}/g, "\n\n"),
  ).trim();
  if (!item.querySelector(":scope > p")) {
    content = outsideCode(content, (prose) => prose.replace(/\n{2,}/g, "\n"));
  }

  const continuationIndent = " ".repeat(bullet.length);
  const [first = "", ...rest] = content.split("\n");
  return [
    `${marker}${first}`,
    ...rest.map((line) => (line.length > 0 ? `${continuationIndent}${line}` : line)),
  ].join("\n");
}

function numberedListItems(list: Element) {
  const start = Number.parseInt(list.getAttribute("start") ?? "1", 10);
  let next = Number.isNaN(start) ? 1 : start;
  return [...list.children].flatMap((item) => {
    if (item.tagName !== "LI") return [];
    const value = Number.parseInt(item.getAttribute("value") ?? "", 10);
    if (!Number.isNaN(value)) next = value;
    return [{ item, number: next++ }];
  });
}

function serializeList(list: Element, ordered: boolean, inTableCell: boolean) {
  const items = numberedListItems(list);
  if (items.length === 0) return "";
  return `${items
    .map(({ item, number }) => serializeListItem(item, ordered, number, inTableCell))
    .join("\n")}\n\n`;
}

function serializeQuoteBody(quote: Element, inTableCell: boolean) {
  let content = "";
  for (const child of quote.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).hasAttribute(ALERT_LABEL)) {
      continue;
    }
    content += serializeNode(child, inTableCell);
  }
  return outsideCode(content, (prose) => prose.replace(/\n{3,}/g, "\n\n")).trim();
}

function serializeBlockquote(quote: Element, inTableCell: boolean, marker = "") {
  const body = serializeQuoteBody(quote, inTableCell);
  const content = marker && body ? `${marker}\n${body}` : marker || body;
  if (!content) return "";
  const quoted = content
    .split("\n")
    .map((line) => (line.length > 0 ? `> ${line}` : ">"))
    .join("\n");
  return `${quoted}\n\n`;
}

function serializeInsight(insight: Element, inTableCell: boolean) {
  const body = serializeQuoteBody(insight, inTableCell);
  return `★ Insight ${"─".repeat(37)}\n${body ? `${body}\n` : ""}${"─".repeat(49)}\n\n`;
}

function serializeDetails(details: Element) {
  const summary =
    details.querySelector(":scope > [data-markdown-details-summary]")?.textContent?.trim() ??
    "Details";
  const contentNode = details.querySelector(":scope > * [data-markdown-details-content]");
  const content = contentNode ? serializeChildren(contentNode).trim() : "";
  const open = details.getAttribute("data-markdown-details-open") === "true" ? " open" : "";
  return `<details${open}>\n<summary>${summary}</summary>${content ? `\n\n${content}` : ""}\n</details>\n\n`;
}

const INLINE_MARKDOWN = /\\(?=[!-/:-@[-`{-~\n]|$)|[`[\]]|\*+|_+|~{2,}/g;
const ESCAPED_PUNCTUATION = /\\([!-/:-@[-`{-~])/g;

function escapeProse(text: string) {
  return text.replace(/\S+/g, (word, wordOffset: number) => {
    const drive = UNFINISHED_DRIVE_PATH.exec(word);
    const driveStart = drive ? drive.index + drive[0].search(/[A-Za-z]/) + 2 : Infinity;
    return word.replace(INLINE_MARKDOWN, (match: string, offset: number) => {
      if (offset >= driveStart) return match;
      const before = text[wordOffset + offset - 1];
      const after = text[wordOffset + offset + match.length];
      if (match === "\\" && after !== undefined && /[^\S\n]/.test(after)) return match;
      const between = (pattern: RegExp) =>
        before !== undefined && after !== undefined && pattern.test(before) && pattern.test(after);
      if (/[*_~]/.test(match[0]!) && between(/\s/)) return match;
      if (match[0] === "_" && between(/[\p{L}\p{N}]/u)) return match;
      return match.replace(/[\s\S]/g, "\\$&");
    });
  });
}

function serializeAnchor(anchor: Element, inTableCell: boolean) {
  const markdownCopy = anchor.getAttribute("data-markdown-copy");
  if (markdownCopy !== null) return escapeTablePipes(markdownCopy, inTableCell);
  const content = serializeChildren(anchor, inTableCell);
  const href = anchor.getAttribute("href") ?? "";
  if (!/^(?:https?:\/\/|mailto:)/i.test(href)) return content;
  const label = content.trim();
  if (!label) return "";
  const shown = label.replace(ESCAPED_PUNCTUATION, "$1");
  if (shown === href) return escapeTablePipes(href, inTableCell);
  if (href === `mailto:${shown}` && /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+(?<=[a-zA-Z])$/.test(shown))
    return shown;
  const destination = escapeTablePipes(href.replace(/[\\()]/g, "\\$&"), inTableCell);
  return `[${label}](${destination})`;
}

function escapeTablePipes(text: string, inTableCell: boolean) {
  return inTableCell ? text.replaceAll("|", "\\|") : text;
}

function serializeChildren(node: Node, inTableCell = false) {
  let out = "";
  for (const child of node.childNodes) {
    out += serializeNode(child, inTableCell);
  }
  return out;
}

function serializeNode(node: Node, inTableCell = false) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (text.includes("\n") && text.trim().length === 0) return "\n";
    return escapeTablePipes(escapeProse(text), inTableCell);
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.hasAttribute("data-markdown-details")) {
    return escapeTablePipes(serializeDetails(element), inTableCell);
  }
  const markdownCopy = element.getAttribute("data-markdown-copy");
  if (markdownCopy !== null) {
    if (element.hasAttribute("data-markdown-mermaid")) {
      return verbatimBlock(escapeTablePipes(markdownCopy.trimEnd(), inTableCell));
    }
    return element.hasAttribute("data-markdown-math")
      ? markdownCopy
      : escapeTablePipes(markdownCopy, inTableCell);
  }
  if (isSkippedElement(element)) return "";
  const alert = element.getAttribute(ALERT_ATTRIBUTE);
  if (alert === "insight") return serializeInsight(element, inTableCell);
  if (alert !== null) return serializeBlockquote(element, inTableCell, `[!${alert.toUpperCase()}]`);

  const headingLevel = /^H([1-6])$/.exec(element.tagName)?.[1];
  if (headingLevel) {
    return `${"#".repeat(Number(headingLevel))} ${serializeChildren(element, inTableCell).trim()}\n\n`;
  }

  switch (element.tagName) {
    case "BR":
      return "\n";
    case "HR":
      return "---\n\n";
    case "P":
      return `${serializeChildren(element, inTableCell).trim()}\n\n`;
    case "PRE":
      return escapeTablePipes(serializeCodeBlock(element), inTableCell);
    case "CODE": {
      const content = escapeTablePipes(element.textContent ?? "", inTableCell);
      return isBlockCodeElement(element, content) ? content : wrapInlineCode(content);
    }
    case "STRONG":
    case "B":
      return wrapInlineMarker(serializeChildren(element, inTableCell), "**");
    case "EM":
    case "I":
      return wrapInlineMarker(serializeChildren(element, inTableCell), "*");
    case "DEL":
    case "S":
      return wrapInlineMarker(serializeChildren(element, inTableCell), "~~");
    case "A":
      return serializeAnchor(element, inTableCell);
    case "IMG": {
      const alt = escapeTablePipes(element.getAttribute("alt") ?? "", inTableCell);
      const src = escapeTablePipes(element.getAttribute("src") ?? "", inTableCell);
      return alt && src ? `![${alt}](${src})` : "";
    }
    case "UL":
      return serializeList(element, false, inTableCell);
    case "OL":
      return serializeList(element, true, inTableCell);
    case "BLOCKQUOTE":
      return serializeBlockquote(element, inTableCell);
    case "TABLE":
      return escapeTablePipes(serializeTable(element), inTableCell);
    case "DIV":
    case "SECTION":
    case "ARTICLE": {
      const content = serializeChildren(element, inTableCell);
      return content && !content.endsWith("\n") ? `${content}\n` : content;
    }
    default:
      return serializeChildren(element, inTableCell);
  }
}

interface SoleCodeBlockScan {
  pre: Element | null;
  other: boolean;
}

function scanForSoleCodeBlock(node: Node, scan: SoleCodeBlockScan) {
  for (const child of node.childNodes) {
    if (scan.other) return;
    if (child.nodeType === Node.TEXT_NODE) {
      if ((child.textContent ?? "").trim().length > 0) scan.other = true;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as Element;
    if (element.hasAttribute("data-markdown-details")) {
      scan.other = true;
      continue;
    }
    const markdownCopy = element.getAttribute("data-markdown-copy");
    if (markdownCopy !== null) {
      if (markdownCopy.trim().length > 0) scan.other = true;
      continue;
    }
    if (isSkippedElement(element)) continue;
    if (element.tagName === "PRE") {
      if (scan.pre) scan.other = true;
      else scan.pre = element;
      continue;
    }
    if (element.tagName === "IMG" || element.tagName === "HR") {
      scan.other = true;
      continue;
    }
    if (element.tagName === "LI") {
      const preBeforeItem = scan.pre;
      scanForSoleCodeBlock(element, scan);
      if (!scan.other && scan.pre === preBeforeItem) scan.other = true;
      continue;
    }
    scanForSoleCodeBlock(element, scan);
  }
}

function soleCodeBlock(container: Node) {
  const scan: SoleCodeBlockScan = { pre: null, other: false };
  scanForSoleCodeBlock(container, scan);
  return scan.other ? null : scan.pre;
}

function tidyMarkdown(markdown: string) {
  const parts = markdown.split(CODE_BOUNDARY);
  const last = parts.length - 1;
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;
      let prose = part.replace(/[ \t]+(?=\n)/g, "").replace(/\n{3,}/g, "\n\n");
      if (index === 0) prose = prose.trimStart();
      if (index === last) prose = prose.trimEnd();
      return prose;
    })
    .join("");
}

export function serializeRenderedMarkdownFragment(container: Node) {
  const codeBlock = soleCodeBlock(container);
  if (codeBlock) return (codeBlock.textContent ?? "").replace(/\n$/, "");
  return tidyMarkdown(serializeChildren(container));
}

export function serializeTableElementToMarkdown(table: Element) {
  return serializeTable(table).replaceAll(CODE_BOUNDARY, "").trim();
}

const MATH_SELECTOR = "[data-markdown-math]";

export function mathWrapperOf(element: Element | null) {
  return element?.closest(MATH_SELECTOR) ?? null;
}

function csvCellText(cell: Element) {
  if (!cell.querySelector(MATH_SELECTOR)) return cell.textContent ?? "";
  const copy = cell.cloneNode(true) as Element;
  for (const wrapper of copy.querySelectorAll(MATH_SELECTOR)) {
    wrapper.replaceWith(wrapper.getAttribute("data-markdown-copy")?.trim() ?? "");
  }
  return copy.textContent ?? "";
}

function csvCell(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return /[",\n]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export function serializeTableElementToCsv(table: Element) {
  const rows = [...table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
  const lines: string[] = [];
  for (const row of rows) {
    const cells = [...row.children].filter(
      (cell) => cell.tagName === "TH" || cell.tagName === "TD",
    );
    if (cells.length === 0) continue;
    lines.push(cells.map((cell) => csvCell(csvCellText(cell))).join(","));
  }
  return lines.join("\n");
}

function mermaidSourceHtml(source: string) {
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = source.trim();
  pre.appendChild(code);
  return pre;
}

function mathSourceElement(wrapper: Element) {
  const code = document.createElement("code");
  code.textContent = wrapper.getAttribute("data-markdown-copy")?.trim() ?? "";
  if (wrapper.getAttribute("data-markdown-math") !== "display") return code;
  const pre = document.createElement("pre");
  pre.append(code);
  return pre;
}

function sanitizedHtmlFrom(container: Element) {
  for (const diagram of container.querySelectorAll("[data-markdown-mermaid]")) {
    const source = diagram.getAttribute("data-markdown-copy");
    if (source !== null) diagram.replaceChildren(mermaidSourceHtml(source));
  }
  for (const wrapper of container.querySelectorAll(MATH_SELECTOR)) {
    wrapper.replaceWith(mathSourceElement(wrapper));
  }
  for (const node of container.querySelectorAll(SANITIZED_HTML_SELECTOR)) {
    if (
      node.classList.contains("chat-markdown-file-link") ||
      node.closest(".chat-markdown-file-link")
    ) {
      if (node.getAttribute("aria-hidden") === "true" || node.localName === "svg") {
        node.remove();
      }
      continue;
    }
    node.remove();
  }
  return `<meta charset="utf-8">${container.innerHTML}`;
}

function keepStartListNumbers(range: Range, container: Element) {
  const chain: Node[] = [];
  for (
    let node: Node | null = range.startContainer;
    node && node !== range.commonAncestorContainer;
    node = node.parentNode
  ) {
    chain.unshift(node);
  }
  let clone: Node | null = container;
  for (const [depth, source] of chain.entries()) {
    clone = clone?.firstChild ?? null;
    if (!(clone instanceof Element) || !(source instanceof Element) || source.tagName !== "OL")
      continue;
    const firstCopied = chain[depth + 1] ?? source.childNodes[range.startOffset];
    if (!firstCopied) continue;
    const shown = numberedListItems(source).find(
      ({ item }) =>
        item === firstCopied ||
        firstCopied.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const cloned = numberedListItems(clone)[0];
    if (shown && cloned && shown.number !== cloned.number) {
      clone.setAttribute("start", String(shown.number));
    }
  }
}

export function chatMarkdownClipboardPayload(selection: Selection) {
  const texts: string[] = [];
  const htmls: string[] = [];
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index);
    if (range.collapsed) continue;
    const container = document.createElement("div");
    container.appendChild(range.cloneContents());
    keepStartListNumbers(range, container);
    const ancestor = range.commonAncestorContainer;
    const ancestorElement =
      ancestor.nodeType === Node.ELEMENT_NODE ? (ancestor as Element) : ancestor.parentElement;
    const diagramSource = ancestorElement
      ?.closest("[data-markdown-mermaid]")
      ?.getAttribute("data-markdown-copy");
    if (diagramSource != null) {
      const text = diagramSource.trim();
      if (!text) continue;
      texts.push(text);
      container.replaceChildren(mermaidSourceHtml(diagramSource));
      htmls.push(sanitizedHtmlFrom(container));
      continue;
    }
    const math = mathWrapperOf(ancestorElement);
    if (math) {
      texts.push(math.getAttribute("data-markdown-copy")?.trim() ?? "");
      htmls.push(`<meta charset="utf-8">${mathSourceElement(math).outerHTML}`);
      continue;
    }
    const link = ancestorElement?.closest("a[data-markdown-copy]");
    if (link) {
      const text = link.getAttribute("data-markdown-copy")?.trim();
      if (!text) continue;
      texts.push(text);
      container.replaceChildren(link.cloneNode(true));
      htmls.push(sanitizedHtmlFrom(container));
      continue;
    }
    if (ancestorElement?.closest("pre, code")) {
      const text = range.toString();
      if (text) {
        texts.push(text);
        htmls.push(sanitizedHtmlFrom(container));
      }
      continue;
    }
    const callout = ancestorElement?.closest(`[${ALERT_ATTRIBUTE}]`);
    if (callout && range.toString().trim() === (callout.textContent ?? "").trim()) {
      const wrapper = callout.cloneNode(false) as Element;
      wrapper.append(...container.childNodes);
      container.replaceChildren(wrapper);
    }
    const text = serializeRenderedMarkdownFragment(container);
    if (!text) continue;
    texts.push(text);
    htmls.push(sanitizedHtmlFrom(container));
  }
  if (texts.length === 0) return null;
  return { text: texts.join("\n\n"), html: htmls.join("") };
}
