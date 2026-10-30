import JSZip from "jszip";
import { externalUrl } from "./links";
import { OFFICE_PREVIEW_MAX_BYTES } from "../officePreviewProtocol";
import {
  officeXml,
  officeXmlDecoder,
  readOfficeEntry,
  xmlParser,
  type OfficeArchiveEntry,
} from "./archiveReader";

const WORD_BUDGET = {
  expandedBytes: OFFICE_PREVIEW_MAX_BYTES,
  documentBytes: 4 * 1024 * 1024,
  bodyBytes: 3 * 1024 * 1024,
  bodyMarkup: 100_000,
  auxiliaryBytes: 1024 * 1024,
  auxiliaryMarkup: 50_000,
  mediaEntryBytes: 8 * 1024 * 1024,
} as const;

export interface WordPreview {
  documents: string[];
  truncated: boolean;
}

interface WordArchiveResult {
  readonly archive: JSZip;
  readonly word: WordPreview | null;
}

function wordSections() {
  const parser = xmlParser();
  const names: string[] = [];
  const namespaceScopes: Record<string, string>[] = [];
  const sections: { end: number; xml: string; body: boolean }[] = [];
  let window = "";
  let offset = 0;
  let capture: {
    start: number;
    insert: number;
    namespaces: string;
    body: boolean;
    depth: number;
  } | null = null;
  let bytes = 0;
  let tags = 0;
  let nextParagraph = false;
  let paragraphSection = false;
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  parser.on("opentag", (tag) => {
    names.push(tag.local);
    namespaceScopes.push(tag.ns);
    if (names.length > 64) throw new Error("This Word document has excessive XML nesting.");
    const body = names.length === 3 && names[1] === "body";
    if (
      tag.local === "sectPr" &&
      tag.uri === "http://schemas.openxmlformats.org/wordprocessingml/2006/main" &&
      (body || (names.length === 5 && names[2] === "p" && names[3] === "pPr" && !nextParagraph))
    ) {
      let namespaces = "";
      const scope = Object.assign({}, ...namespaceScopes) as Record<string, string>;
      for (const prefix in scope) {
        const name = prefix ? `xmlns:${prefix}` : "xmlns";
        if (prefix !== "xml" && !tag.attributes[name])
          namespaces += ` ${name}="${escape(scope[prefix]!)}"`;
      }
      const start = window.lastIndexOf("<", parser.position - offset - 1);
      if (start < 0) throw new Error("This Word document has too much section markup.");
      capture = {
        start: start + offset,
        insert: parser.position - (tag.isSelfClosing ? 2 : 1),
        namespaces,
        body,
        depth: names.length,
      };
    }
    if (capture && ++tags > 2_000)
      throw new Error("Preview limited: this Word document has too much section markup.");
  });
  parser.on("closetag", (tag) => {
    if (capture && tag.local === "sectPr" && names.length === capture.depth) {
      const xml =
        window.slice(capture.start - offset, capture.insert - offset) +
        capture.namespaces +
        window.slice(capture.insert - offset, parser.position - offset);
      bytes += xml.length;
      if (bytes > 128 * 1024)
        throw new Error("Preview limited: this Word document has too much section markup.");
      sections.push({ end: parser.position, xml, body: capture.body });
      paragraphSection = !capture.body;
      if (!capture.body && parser.position > WORD_BUDGET.documentBytes) nextParagraph = true;
      capture = null;
    }
    if (names.length === 3 && tag.local === "p" && paragraphSection) {
      sections[sections.length - 1]!.end = parser.position;
      paragraphSection = false;
    }
    names.pop();
    namespaceScopes.pop();
  });
  return {
    write(chunk: string) {
      window += chunk;
      parser.write(chunk);
      if (capture && parser.position - capture.start > 128 * 1024)
        throw new Error("Preview limited: this Word document has too much section markup.");
      const keep = capture?.start ?? Math.max(offset, parser.position - 128 * 1024);
      window = window.slice(keep - offset);
      offset = keep;
    },
    finish() {
      parser.close();
      return sections;
    },
  };
}

function wordDocuments(
  xml: string,
  incomplete: boolean,
  sections: ReturnType<ReturnType<typeof wordSections>["finish"]>,
) {
  const parser = xmlParser();
  const names: string[] = [];
  const batches: { content: string; end: number }[] = [];
  let prefix = "";
  let suffix = "";
  let boundary = 0;
  let batchStart = 0;
  let tags = 0;
  let elementTags = 0;
  let batchTags = 0;
  let elements = 0;
  let truncated = incomplete;
  const limit = Symbol("Word preview limit");
  parser.on("opentag", (tag) => {
    names.push(tag.name);
    if (names.length === 2 && tag.local === "body") {
      prefix = xml.slice(0, parser.position).replace(/\/>$/, ">");
      suffix = `</${tag.name}></${names[0]}>`;
      boundary = batchStart = parser.position;
    } else if (prefix && names.length > 2) {
      if (names.length === 3 && ++elements > 5_000) throw limit;
      tags++;
      elementTags++;
      batchTags++;
      if (
        tags > WORD_BUDGET.bodyMarkup ||
        elementTags > 2_000 ||
        parser.position - boundary > 128 * 1024
      )
        throw limit;
    }
    if (names.length > 64) throw limit;
  });
  parser.on("closetag", (tag) => {
    if (prefix && names.length === 3 && tag.local !== "sectPr") {
      if (parser.position - prefix.length > WORD_BUDGET.bodyBytes) throw limit;
      boundary = parser.position;
      elementTags = 0;
      if (batchTags >= 500) {
        batches.push({ content: xml.slice(batchStart, boundary), end: boundary });
        batchStart = boundary;
        batchTags = 0;
      }
    }
    names.pop();
  });
  try {
    for (let offset = 0; offset < xml.length; offset += 16 * 1024) {
      parser.write(xml.slice(offset, offset + 16 * 1024));
      if (prefix && parser.position - boundary > 128 * 1024) throw limit;
    }
    if (!incomplete) parser.close();
  } catch (cause) {
    if (cause !== limit) throw cause;
    truncated = true;
  }
  if (!prefix) throw new Error("This Word document has no readable body.");
  if (boundary > batchStart || batches.length === 0)
    batches.push({ content: xml.slice(batchStart, boundary), end: boundary });
  const documents: string[] = [];
  let length = 0;
  let markup = 0;
  for (const batch of batches) {
    const section = sections.find((section) => section.body || section.end >= batch.end);
    const document = prefix + batch.content + (section?.xml ?? "") + suffix;
    length += batch.content.length;
    markup += batch.content.match(/<(?![!?/])/g)?.length ?? 0;
    if (length > WORD_BUDGET.bodyBytes || markup > WORD_BUDGET.bodyMarkup) {
      truncated = true;
      break;
    }
    documents.push(document);
  }
  if (documents.length === 0) throw new Error("This Word document has too much section markup.");
  return { documents, truncated };
}

const WORD_RELATIONSHIP = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const WORD_EXPANDED_PARTS = new Set(["footnotes", "endnotes", "comments", "header", "footer"]);
const WORD_DISABLED_PARTS = new Set(["commentsExtended", "fontTable", "aFChunk"]);
const WORD_BINARY_PARTS = new Set([
  "image",
  "font",
  "thumbnail",
  "audio",
  "video",
  "oleObject",
  "package",
  "printerSettings",
  "vbaProject",
  "origin",
  "certificate",

  "core-properties",
  "extended-properties",
  "custom-properties",
  "signature",
]);

function wordPartTypes() {
  const defaults = new Map<string, string>();
  const overrides = new Map<string, string>();
  const xmlParts = new Set([
    "word/document.xml",
    "docProps/app.xml",
    "docProps/core.xml",
    "docProps/custom.xml",
  ]);
  const roles = new Map<string, Set<string>>();
  const relationships = new Map<string, Map<string, string>>();
  return {
    roles,
    relationships,
    binary(path: string) {
      const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
      const type = overrides.get(path) ?? defaults.get(extension) ?? "";

      if (
        path === "[Content_Types].xml" ||
        extension === "rels" ||
        extension === "xml" ||
        xmlParts.has(path) ||
        /(?:\+xml|\/xml)$/i.test(type)
      )
        return false;
      return (
        [...(roles.get(path) ?? [])].some((role) => WORD_BINARY_PARTS.has(role)) ||
        /^(?:image|audio|video|font)\//i.test(type) ||
        /^(?:png|jpe?g|gif|webp|bmp|tiff?|ico|bin|sigs|cer|ttf|otf|odttf|woff2?)$/.test(
          extension,
        ) ||
        type === "application/octet-stream" ||
        type === "application/vnd.openxmlformats-package.digital-signature-origin"
      );
    },
    metadata(path: string, xml: string) {
      const parser = xmlParser();
      const removed: { start: number; end: number }[] = [];
      let start = -1;
      parser.on("opentag", (tag) => {
        const attr = (name: string) => tag.attributes[name]?.value ?? "";
        if (path === "[Content_Types].xml") {
          if (tag.local === "Default")
            defaults.set(attr("Extension").toLowerCase(), attr("ContentType"));
          if (tag.local === "Override")
            overrides.set(attr("PartName").replace(/^\//, ""), attr("ContentType"));
        }
        if (tag.local !== "Relationship" || !path.endsWith(".rels")) return;
        const type = attr("Type");
        const role = type.slice(type.lastIndexOf("/") + 1);
        const external =
          attr("TargetMode").toLowerCase() === "external" ||
          /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(attr("Target"));
        const folder = path === "_rels/.rels" ? "" : path.replace(/_rels\/[^/]+\.rels$/, "");

        const target = new URL(attr("Target"), `https://docx.invalid/${folder}`)
          .toString()
          .slice("https://docx.invalid/".length);
        if (!external) {
          if (
            !WORD_BINARY_PARTS.has(role) &&
            role !== "hyperlink" &&
            (type.startsWith(WORD_RELATIONSHIP) ||
              role === "core-properties" ||
              role === "signature")
          )
            xmlParts.add(target);
          const types = roles.get(target) ?? new Set<string>();
          types.add(role);
          roles.set(target, types);
          const owner = path === "_rels/.rels" ? "" : path.replace(/_rels\/([^/]+)\.rels$/, "$1");
          const refs = relationships.get(owner) ?? new Map<string, string>();
          if (!refs.has(attr("Id"))) refs.set(attr("Id"), target);
          relationships.set(owner, refs);
          if (target === "word/document.xml" && role !== "officeDocument")
            throw new Error("Preview limited: this Word document has an aliased document part.");
          if (type === WORD_RELATIONSHIP + "officeDocument" && target !== "word/document.xml")
            throw new Error(
              "Preview limited: this Word document has an unsupported document relationship.",
            );
        }
        if (
          (external && !(role === "hyperlink" && externalUrl(attr("Target")))) ||
          WORD_DISABLED_PARTS.has(role)
        ) {
          start = xml.lastIndexOf("<", parser.position - 1);
        }
      });
      parser.on("closetag", (tag) => {
        if (tag.local === "Relationship" && start >= 0) {
          removed.push({ start, end: parser.position });
          start = -1;
        }
      });
      parser.write(xml).close();
      for (const range of removed.toReversed())
        xml = xml.slice(0, range.start) + xml.slice(range.end);
      return xml;
    },
  };
}

const WORD_STYLE_MAX_BYTES = 1024 * 1024;
const WORD_STYLE_MAX_UNITS = 20_000;

function wordXmlCost(xml: string, roles: Set<string> | undefined) {
  const parser = xmlParser();
  let depth = 0;
  let markup = 0;
  const limit = Symbol("Word style budget");
  const exceeded = { bytes: Infinity, markup: Infinity, pictures: false };
  let styleCount = 0;
  let ownUnits = 0;
  const styles = new Map<
    string,
    { properties: Map<string, number>; base: string; linked: string }
  >();
  let style: { id: string; base: string; linked: string; properties: Map<string, number> } | null =
    null;
  const names: string[] = [];
  const definitions = new Map<string, { bytes: number; markup: number }>();
  const references: { id: string; selector: number }[] = [];
  let definition: { id: string; start: number; markup: number } | null = null;
  let reference: { id: string; selector: number } | null = null;
  let pictures = false;
  parser.on("opentag", (tag) => {
    if (++depth > 64)
      throw new Error("Preview limited: this Word document has excessive XML nesting.");
    markup++;
    const attr = (name: string) =>
      Object.values(tag.attributes).find((a) => a.local === name)?.value ?? "";
    names.push(tag.local === "tblStylePr" ? `${tag.local}:${attr("type")}` : tag.local);
    if (roles?.has("styles") && (tag.local === "style" || tag.local === "docDefaults")) {
      if (++styleCount > 1_024 || attr("styleId").length > 256) throw limit;
      style = { id: attr("styleId"), properties: new Map(), base: "", linked: "" };
    }
    if (style) {
      if (tag.local === "basedOn") style.base = attr("val");
      else if (tag.local === "link") style.linked = attr("val");
      else if (names.length > 2 && tag.local !== "name") {
        const key = names.slice(2).join("/");
        const size = new TextEncoder().encode(
          xml.slice(xml.lastIndexOf("<", parser.position - 1), parser.position),
        ).length;
        if (++ownUnits > WORD_STYLE_MAX_UNITS) throw limit;
        style.properties.set(key, size);
      }
    }
    if (roles?.has("numbering")) {
      if (tag.local === "abstractNum")
        definition = {
          id: attr("abstractNumId"),
          start: xml.lastIndexOf("<", parser.position - 1),
          markup: markup - 1,
        };
      if (tag.local === "num") {
        if (references.length >= 2_000) throw limit;
        reference = { id: "", selector: attr("numId").length + 32 };
        references.push(reference);
      }
      if (tag.local === "abstractNumId" && reference) reference.id = attr("val");
    }
    if (tag.local === "numPicBullet") pictures = true;
  });
  parser.on("closetag", (tag) => {
    if (definition && tag.local === "abstractNum") {
      const previous = definitions.get(definition.id);
      definitions.set(definition.id, {
        bytes:
          (previous?.bytes ?? 0) +
          new TextEncoder().encode(xml.slice(definition.start, parser.position)).length,
        markup: (previous?.markup ?? 0) + markup - definition.markup,
      });
      definition = null;
    }
    if (tag.local === "num") reference = null;
    if (style && (tag.local === "style" || tag.local === "docDefaults")) {
      styles.set(style.id, style);
      style = null;
    }
    names.pop();
    depth--;
  });
  try {
    parser.write(xml).close();
  } catch (cause) {
    if (cause !== limit) throw cause;
    return exceeded;
  }
  const rawBytes = new TextEncoder().encode(xml).length;
  if (roles?.has("styles")) {
    type Resolved = {
      properties: Map<string, number>;
      parent?: Resolved | undefined;
      depth: number;
    };
    const resolved = new Map<string, Resolved>();
    for (const [id, style] of styles) resolved.set(id, { properties: style.properties, depth: 1 });
    for (const [id, style] of styles) {
      const parent = style.base ? resolved.get(style.base) : undefined;
      if (parent && parent.depth >= 32) return exceeded;
      resolved.set(id, { properties: style.properties, parent, depth: (parent?.depth ?? 0) + 1 });
    }
    let bytes = 0;
    let expandedMarkup = 0;
    let visited = 0;
    let propertyVisits = 0;
    for (const [id, style] of styles) {
      for (const root of [
        resolved.get(id),
        style.linked ? resolved.get(style.linked) : undefined,
      ]) {
        const seen = new Set<string>();
        for (let node = root; node; node = node.parent) {
          if (++visited > 8_192) return exceeded;
          for (const [key, size] of node.properties) {
            if (++propertyVisits > 100_000) return exceeded;
            if (seen.has(key)) continue;

            const copies = id ? 1 : 2;
            bytes += (size * 2 + id.length + 32) * copies;
            expandedMarkup += copies;
            if (bytes > WORD_STYLE_MAX_BYTES || expandedMarkup > WORD_STYLE_MAX_UNITS)
              return exceeded;
            seen.add(key);
          }
        }
      }
    }
    return { bytes, markup: expandedMarkup, pictures };
  }
  let bytes = rawBytes;
  if (roles?.has("numbering")) {
    for (const ref of references) {
      const cost = definitions.get(ref.id);
      if (!cost) continue;
      bytes += cost.bytes * 2 + cost.markup * ref.selector;
      markup += cost.markup;
      if (bytes > 128 * 1024 || markup > 2_000) return exceeded;
    }
  }
  return { bytes, markup, pictures };
}

async function wordExpansion(
  archive: JSZip,
  parts: ReturnType<typeof wordPartTypes>,
  mediaSizes: Map<string, number>,
  auxiliaryCosts: Map<string, { bytes: number; markup: number }>,
  documents: string[],
) {
  type Cost = { bytes: number; markup: number; media: number; images: Set<string> };
  const empty = (): Cost => ({ bytes: 0, markup: 0, media: 0, images: new Set() });
  const nodes = new Map<string, { xml: string; path: string }>();
  const optional = new Set<string>();
  const noteParts = new Map<string, string>();
  for (const [path, roles] of parts.roles) {
    if (![...roles].some((role) => WORD_EXPANDED_PARTS.has(role))) continue;
    const xml = await archive.file(path)?.async("string");
    if (!xml) continue;
    optional.add(path);
    if (roles.has("header") || roles.has("footer")) nodes.set(path, { xml, path });
    for (const role of ["footnotes", "endnotes", "comments"]) {
      if (!roles.has(role)) continue;
      noteParts.set(role.slice(0, -1), path);
      const parser = xmlParser();
      let start = 0;
      let id = "";
      let depth = 0;
      let prefix = "";
      let suffix = "";
      parser.on("opentag", (tag) => {
        if (++depth === 1) {
          prefix = xml.slice(0, parser.position);
          suffix = `</${tag.name}>`;
        }
        if (tag.local !== role.slice(0, -1)) return;
        start = xml.lastIndexOf("<", parser.position - 1);
        id = Object.values(tag.attributes).find((attr) => attr.local === "id")?.value ?? "";
      });
      parser.on("closetag", (tag) => {
        if (tag.local === role.slice(0, -1))
          nodes.set(`${path}#${id}`, {
            xml: prefix + xml.slice(start, parser.position) + suffix,
            path,
          });
        depth--;
      });
      parser.write(xml).close();
    }
  }
  const used = new Set<string>();
  const memo = new Map<string, Cost>();
  let expandedXmlBytes = 0;
  const scan = (xml: string, path: string, chain: Set<string>, pages = 1, expand = true): Cost => {
    const cost = empty();
    const refs = new Map<string, number>();
    const headers = new Set<string>();
    const parser = xmlParser();
    const add = (key: string) => refs.set(key, (refs.get(key) ?? 0) + 1);
    parser.on("opentag", (tag) => {
      const attr = (name: string) =>
        Object.values(tag.attributes).find((a) => a.local === name)?.value ?? "";
      const note = /^(footnote|endnote|comment)Reference$/.exec(tag.local)?.[1];
      if (note && noteParts.has(note)) add(`${noteParts.get(note)}#${attr("id")}`);
      if (tag.local === "headerReference" || tag.local === "footerReference") {
        const target = parts.relationships.get(path)?.get(attr("id"));
        if (target) headers.add(target);
      }
      if (tag.local === "altChunk") cost.bytes = Infinity;
      if (tag.local !== "blip" && tag.local !== "imagedata") return;
      const target = parts.relationships.get(path)?.get(attr("embed") || attr("id"));
      if (target) {
        cost.media += mediaSizes.get(target) ?? OFFICE_PREVIEW_MAX_BYTES + 1;
        cost.images.add(target);
      }
    });
    parser.write(xml).close();
    for (const header of headers) refs.set(header, pages);
    if (!expand) return cost;
    for (const [key, copies] of refs) {
      const node = nodes.get(key);
      if (!node) continue;
      used.add(node.path);
      if (chain.has(key) || chain.size >= 64) {
        cost.bytes = Infinity;
        break;
      }
      let expanded = memo.get(key);
      if (!expanded) {
        expandedXmlBytes += node.xml.length * 2;
        if (expandedXmlBytes > WORD_BUDGET.bodyBytes) {
          cost.bytes = Infinity;
          break;
        }
        const own = wordXmlCost(node.xml, undefined);
        expanded = scan(node.xml, node.path, new Set([...chain, key]));
        expanded.bytes += own.bytes;
        expanded.markup += own.markup;
        memo.set(key, expanded);
      }
      cost.bytes += expanded.bytes * copies;
      cost.markup += expanded.markup * copies;
      cost.media += expanded.media * copies;
      for (const image of expanded.images) cost.images.add(image);
    }
    return cost;
  };
  const costs = new Map<string, Cost>();
  let bytes = 0;
  let markup = 0;
  let media = 0;

  let stylePageBreaks = false;
  for (const [path, roles] of parts.roles)
    if (
      roles.has("styles") &&
      /<(?:\w+:)?pageBreakBefore\b/.test((await archive.file(path)?.async("string")) ?? "")
    )
      stylePageBreaks = true;
  for (const document of documents) {
    const pages = Math.max(
      1,
      document.match(
        stylePageBreaks ? /<(?:\w+:)?p\b/g : /<(?:\w+:)?(?:br|pageBreakBefore|sectPr)\b/g,
      )?.length ?? 0,
    );
    const expanded = scan(document, "word/document.xml", new Set(), pages);
    const body = wordXmlCost(document, undefined);
    bytes += body.bytes + expanded.bytes;
    markup += body.markup + expanded.markup;
    media += expanded.media;
    costs.set(document, expanded);
  }
  for (const [path, cost] of auxiliaryCosts) {
    if (optional.has(path) && !used.has(path)) continue;
    bytes += cost.bytes;
    markup += cost.markup;
  }
  const overBudget =
    bytes > WORD_BUDGET.bodyBytes ||
    markup > WORD_BUDGET.bodyMarkup ||
    media > WORD_BUDGET.expandedBytes;
  const truncated = (used.size > 0 && overBudget) || bytes === Infinity;
  const omitted = new Set([...optional].filter((path) => truncated || !used.has(path)));
  for (const path of omitted) archive.remove(path);
  if (truncated)
    for (const document of documents)
      costs.set(document, scan(document, "word/document.xml", new Set(), 1, false));

  for (const [owner, refs] of parts.relationships) {
    const ids = new Set([...refs].flatMap(([id, path]) => (omitted.has(path) ? [id] : [])));
    if (ids.size === 0) continue;
    const relPath = owner ? owner.replace(/([^/]+)$/, "_rels/$1.rels") : "_rels/.rels";
    let xml = await archive.file(relPath)?.async("string");
    if (!xml) continue;
    const removed: { start: number; end: number }[] = [];
    const parser = xmlParser();
    let start = -1;
    parser.on("opentag", (tag) => {
      if (tag.local === "Relationship" && ids.has(tag.attributes.Id?.value ?? ""))
        start = xml!.lastIndexOf("<", parser.position - 1);
    });
    parser.on("closetag", (tag) => {
      if (tag.local === "Relationship" && start >= 0) {
        removed.push({ start, end: parser.position });
        start = -1;
      }
    });
    parser.write(xml).close();
    for (const range of removed.toReversed())
      xml = xml.slice(0, range.start) + xml.slice(range.end);
    archive.file(relPath, xml);
  }
  return { costs, truncated, omitted };
}

export async function prepareWordArchive(
  entries: readonly OfficeArchiveEntry[],
): Promise<WordArchiveResult> {
  if (entries.some((entry) => entry.name.includes("\\") || entry.name.startsWith("/")))
    throw new Error("Preview limited: this Word document has unsupported archive paths.");
  const archive = new JSZip();
  const partTypes = wordPartTypes();
  const ordered = [...entries].sort(
    (a, b) =>
      Number(b.name === "[Content_Types].xml" || b.name.endsWith(".rels")) -
      Number(a.name === "[Content_Types].xml" || a.name.endsWith(".rels")),
  );
  const costs = new Map<string, { bytes: number; markup: number }>();
  const mediaSizes = new Map<string, number>();
  let expandedBytes = 0;
  let auxiliaryMarkup = 0;
  let wordInputTruncated = false;
  let word: WordPreview | null = null;
  for (const entry of ordered) {
    const document = entry.name === "word/document.xml";
    const media = !document && partTypes.binary(entry.name);
    const sections = document ? wordSections() : null;
    let decoder: TextDecoder | undefined;
    const content = await readOfficeEntry(entry, {
      remainingExpandedBytes: WORD_BUDGET.expandedBytes - expandedBytes,
      ...(document
        ? { retainedBytes: WORD_BUDGET.documentBytes }
        : media
          ? { entryBytes: WORD_BUDGET.mediaEntryBytes }
          : {}),
      onChunk(chunk, length) {
        if (sections) {
          decoder ??= officeXmlDecoder(chunk);
          sections.write(decoder.decode(chunk, { stream: true }));
        }
        if (!document && !media) {
          for (const byte of chunk) if (byte === 0x3c) auxiliaryMarkup++;
          if (length > WORD_BUDGET.auxiliaryBytes || auxiliaryMarkup > WORD_BUDGET.auxiliaryMarkup)
            throw new Error("Preview limited: this Word document has too much auxiliary markup.");
        }
      },
    });
    expandedBytes += content.expandedBytes;
    if (document) {
      wordInputTruncated ||= content.expandedBytes > WORD_BUDGET.documentBytes;
      sections!.write(decoder?.decode() ?? "");
      word = wordDocuments(officeXml(content.bytes), wordInputTruncated, sections!.finish());
      archive.file(entry.name, word.documents[0]!);
    } else if (!media) {
      let xml = officeXml(content.bytes);
      if (entry.name === "[Content_Types].xml" || entry.name.endsWith(".rels"))
        xml = partTypes.metadata(entry.name, xml);
      const roles = partTypes.roles.get(entry.name);
      const cost = wordXmlCost(xml, roles);
      if (roles && [...roles].every((role) => WORD_DISABLED_PARTS.has(role))) continue;
      if (
        (roles?.has("numbering") && cost.pictures) ||
        (roles?.has("styles") &&
          (cost.bytes > WORD_STYLE_MAX_BYTES || cost.markup > WORD_STYLE_MAX_UNITS)) ||
        (roles?.has("numbering") && (cost.bytes > 128 * 1024 || cost.markup > 2_000))
      ) {
        wordInputTruncated = true;
        continue;
      }
      costs.set(entry.name, cost);
      archive.file(entry.name, xml);
    } else {
      if (partTypes.roles.get(entry.name)?.has("font")) continue;
      mediaSizes.set(entry.name, Math.ceil((content.bytes.length * 4) / 3));
      archive.file(
        entry.name,
        /\.(?:xml|rels)$/i.test(entry.name) ? officeXml(content.bytes) : content.bytes,
      );
    }
  }
  if (word) {
    const expansion = await wordExpansion(archive, partTypes, mediaSizes, costs, word.documents);
    wordInputTruncated ||= expansion.truncated;
    for (const path of expansion.omitted) {
      archive.remove(path);
      costs.delete(path);
    }
    let mediaBytes = 0;
    const usedImages = new Set<string>();
    const auxiliary = [...costs.values()].reduce(
      (sum, cost) => ({ bytes: sum.bytes + cost.bytes, markup: sum.markup + cost.markup }),
      { bytes: 0, markup: 0 },
    );

    let bytes = auxiliary.bytes;
    let markup = auxiliary.markup;
    const documents: string[] = [];
    for (const document of word.documents) {
      const rawCost = wordXmlCost(document, undefined);
      const extra = expansion.costs.get(document)!;
      const cost = { bytes: rawCost.bytes + extra.bytes, markup: rawCost.markup + extra.markup };
      const images = extra.media;
      const batchImages = new Set(extra.images);
      if (
        bytes + cost.bytes > WORD_BUDGET.bodyBytes ||
        markup + cost.markup > WORD_BUDGET.bodyMarkup ||
        mediaBytes + images > WORD_BUDGET.expandedBytes
      )
        break;
      bytes += cost.bytes;
      markup += cost.markup;
      mediaBytes += images;
      for (const path of batchImages) usedImages.add(path);
      documents.push(document);
    }
    if (documents.length === 0)
      throw new Error("Preview limited: this Word document has too much expanded markup.");
    word.truncated ||= wordInputTruncated || documents.length < word.documents.length;
    word.documents = documents;
    for (const path of mediaSizes.keys()) if (!usedImages.has(path)) archive.remove(path);
    archive.file("word/document.xml", documents[0]!);
  }
  return { archive, word };
}

export async function assembleWordDocument(archive: JSZip, word: WordPreview) {
  const root = "word/document.xml";
  const references = new Map<string, string>();
  const relationships = xmlParser();
  relationships.on("opentag", (tag) => {
    if (tag.local !== "Relationship") return;
    const type = tag.attributes.Type?.value ?? "";
    const target = tag.attributes.Target?.value ?? "";
    const path = new URL(target, "https://docx.invalid/word/").pathname.slice(1);
    if (archive.file(path))
      references.set(tag.attributes.Id?.value ?? "", type.slice(type.lastIndexOf("/") + 1));
  });
  const relationshipXml = await archive.file("word/_rels/document.xml.rels")?.async("string");
  if (relationshipXml) relationships.write(relationshipXml).close();
  let xml = joinWordBatches(word.documents);
  const removed: { start: number; end: number }[] = [];
  const parser = xmlParser();
  let start = -1;

  parser.on("opentag", (tag) => {
    if (tag.local !== "headerReference" && tag.local !== "footerReference") return;
    const id = Object.values(tag.attributes).find((attr) => attr.local === "id")?.value ?? "";
    if (references.get(id) !== tag.local.replace("Reference", ""))
      start = xml.lastIndexOf("<", parser.position - 1);
  });
  parser.on("closetag", (tag) => {
    if (start >= 0 && (tag.local === "headerReference" || tag.local === "footerReference")) {
      removed.push({ start, end: parser.position });
      start = -1;
    }
  });
  parser.write(xml).close();
  for (const range of removed.toReversed()) xml = xml.slice(0, range.start) + xml.slice(range.end);
  archive.file(root, xml);
}

function joinWordBatches(documents: string[]) {
  let prefix = "";
  let suffix = "";
  let section = "";
  const bodies: string[] = [];
  for (const xml of documents) {
    const parser = xmlParser();
    let depth = 0;
    let start = 0;
    let end = 0;
    let sectionStart = 0;
    parser.on("opentag", (tag) => {
      depth++;
      if (depth === 2 && tag.local === "body") {
        start = parser.position;
        if (!prefix) prefix = xml.slice(0, start);
      }
      if (depth === 3 && tag.local === "sectPr")
        sectionStart = xml.lastIndexOf("<", parser.position - 1);
    });
    parser.on("closetag", (tag) => {
      if (depth === 2 && tag.local === "body") {
        end = xml.lastIndexOf("<", parser.position - 1);
        suffix = xml.slice(end);
      }
      depth--;
    });
    parser.write(xml).close();
    bodies.push(xml.slice(start, sectionStart || end));
    section = sectionStart ? xml.slice(sectionStart, end) : "";
  }
  return prefix + bodies.join("") + section + suffix;
}
