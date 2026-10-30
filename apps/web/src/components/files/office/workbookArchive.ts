import type JSZip from "jszip";
import { OFFICE_PREVIEW_MAX_COLUMNS, OFFICE_PREVIEW_MAX_ROWS } from "../officePreviewProtocol";
import { readOfficeParts, xmlParser, type OfficeArchiveEntry } from "./archiveReader";

const WORKBOOK_BUDGET = {
  expandedBytes: 128 * 1024 * 1024,
  entryBytes: 64 * 1024 * 1024,
  compressionRatio: 200,
  expansionFloor: 8 * 1024 * 1024,
  textCharacters: 1024 * 1024,
  cellCharacters: 4096,
  cells: 2_000_000,
  gridPositions: 8_000_000,
  sheets: 100,
} as const;

interface WorksheetBudget {
  readonly remainingTextCharacters: number;
  readonly usedCells: number;
}

interface WorkbookArchiveResult {
  readonly archive: JSZip;
  readonly truncatedSheets: boolean[];
}

export async function prepareWorkbookArchive(
  entries: readonly OfficeArchiveEntry[],
  compressedBytes: number,
): Promise<WorkbookArchiveResult> {
  const archive = await readOfficeParts(entries, {
    expandedBytes: Math.min(
      WORKBOOK_BUDGET.expandedBytes,
      Math.max(compressedBytes * WORKBOOK_BUDGET.compressionRatio, WORKBOOK_BUDGET.expansionFloor),
    ),
    entryBytes: WORKBOOK_BUDGET.entryBytes,
  });
  return { archive, truncatedSheets: await boundWorkbook(archive) };
}

function boundedWorksheet(xml: string, strings: readonly string[], available: WorksheetBudget) {
  const budget = { ...available };
  const parser = xmlParser();
  const rows = new Map<number, Map<number, string>>();
  const rowTags = new Map<number, string>();
  const metadataAttributes = new Map<
    string,
    { ref: string | undefined; min: string | undefined; max: string | undefined }
  >();
  let dataStart = 0;
  let dataEnd = 0;
  let emptyData = false;
  let depth = 0;
  let row = 0;
  let explicitRow = false;
  let rowTag = "";
  let column = 0;
  let maxRow = 0;
  let maxColumn = 0;
  let cells = new Map<number, string>();
  let cell: {
    start: number;
    opening: string;
    name: string;
    prefix: string;
    selfClosing: boolean;
    text: string;
    value: string;
    reading: string;
    shared: boolean;
  } | null = null;
  let truncated = false;
  const coordinate = (ref: string) => {
    const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(ref);
    if (!match) throw new Error("This workbook contains invalid cell coordinates.");
    let col = 0;
    for (const letter of match[1]!) col = col * 26 + letter.charCodeAt(0) - 64;
    const line = Number(match[2]);
    if (col > 16384 || line > 1048576)
      throw new Error("This workbook contains invalid worksheet dimensions.");
    return { col, line };
  };
  parser.on("opentag", (tag) => {
    depth++;
    if (depth > 64) throw new Error("This workbook contains excessive XML nesting.");
    if (
      (tag.local === "row" && depth !== 3) ||
      (tag.local === "c" && depth !== 4) ||
      ((tag.local === "dimension" || tag.local === "sheetData") && depth !== 2)
    )
      throw new Error("This workbook contains invalid worksheet structure.");
    const attribute = (name: string) => tag.attributes[name]?.value;
    if (["dimension", "mergeCell", "col"].includes(tag.local))
      metadataAttributes.set(
        xml.slice(xml.lastIndexOf("<", parser.position - 1), parser.position),
        {
          ref: attribute("ref"),
          min: attribute("min"),
          max: attribute("max"),
        },
      );
    if (depth === 2 && tag.local === "sheetData") {
      dataStart = parser.position;
      emptyData = tag.isSelfClosing;
    }
    if (depth === 2 && tag.local === "dimension") {
      for (const ref of (attribute("ref") ?? "").split(":")) {
        const { col, line } = coordinate(ref);
        if (col > OFFICE_PREVIEW_MAX_COLUMNS || line > OFFICE_PREVIEW_MAX_ROWS) truncated = true;
      }
    } else if (depth === 3 && tag.local === "row") {
      explicitRow = attribute("r") !== undefined;
      row = attribute("r") === undefined ? row + 1 : Number(attribute("r"));
      if (!Number.isInteger(row) || row < 1 || row > 1048576)
        throw new Error("This workbook contains invalid row coordinates.");
      rowTag = xml
        .slice(xml.lastIndexOf("<", parser.position - 1), parser.position)
        .replace(/\/>$/, ">");
      column = 0;
      cells = rows.get(row) ?? new Map<number, string>();
      if (row > OFFICE_PREVIEW_MAX_ROWS)
        throw new Error("This workbook exceeds the preview limit: 250,000 rows.");
    } else if (depth === 4 && tag.local === "c") {
      const ref = attribute("r");
      const position = ref ? coordinate(ref) : { col: column + 1, line: row };
      if (!explicitRow && column === 0) row = position.line;
      column = position.col;
      if (row < 1 || position.line !== row)
        throw new Error("This workbook contains inconsistent cell rows.");
      if (row > OFFICE_PREVIEW_MAX_ROWS || column > OFFICE_PREVIEW_MAX_COLUMNS) {
        truncated = true;
        return;
      }
      maxRow = Math.max(maxRow, row);
      maxColumn = Math.max(maxColumn, column);
      if (
        ++budget.usedCells > WORKBOOK_BUDGET.cells ||
        maxRow * maxColumn > WORKBOOK_BUDGET.gridPositions
      )
        throw new Error(
          "This workbook exceeds the preview limit: 2 million cells or 8 million grid positions.",
        );

      let letters = "";
      for (let value = column; value > 0; value = Math.floor((value - 1) / 26))
        letters = String.fromCharCode(65 + ((value - 1) % 26)) + letters;
      const style = attribute("s");
      const type = attribute("t");
      if ((style && !/^\d{1,6}$/.test(style)) || (type && !/^[a-zA-Z]+$/.test(type)))
        throw new Error("This workbook contains invalid cell metadata.");
      cell = {
        start: parser.position,
        opening: xml
          .slice(xml.lastIndexOf("<", parser.position - 1), parser.position)
          .replace(/\/?>$/, `${ref ? "" : ` r="${letters}${row}"`}>`),
        name: tag.name,
        prefix: tag.prefix ? `${tag.prefix}:` : "",
        selfClosing: tag.isSelfClosing,
        text: "",
        value: "",
        reading: "",
        shared: type === "s",
      };
    }
    if (cell && (tag.local === "t" || tag.local === "v")) cell.reading = tag.local;
  });
  const readCellText = (chunk: string) => {
    if (cell?.reading === "t") cell.text += chunk;
    if (cell?.reading === "v") cell.value += chunk;
  };
  parser.on("text", readCellText);
  parser.on("cdata", readCellText);
  parser.on("closetag", (tag) => {
    if (depth === 4 && tag.local === "c" && cell) {
      const end = cell.selfClosing ? cell.start : xml.lastIndexOf("<", parser.position - 1);
      const raw = cell.opening + xml.slice(cell.start, end) + `</${cell.name}>`;
      const shown = cell.shared ? (strings[Number(cell.value)] ?? "") : cell.text || cell.value;
      const kept = shown.slice(
        0,
        Math.min(WORKBOOK_BUDGET.cellCharacters, budget.remainingTextCharacters),
      );
      budget.remainingTextCharacters -= kept.length;
      if (kept.length < shown.length) {
        truncated = true;
        const escape = (s: string) =>
          s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
        cells.set(
          column,
          cell.opening
            .replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/, "")
            .replace(/>$/, ' t="inlineStr">') +
            `<${cell.prefix}is><${cell.prefix}t>` +
            escape(kept) +
            `</${cell.prefix}t></${cell.prefix}is></${cell.name}>`,
        );
      } else cells.set(column, raw);
      cell = null;
    } else if (depth === 3 && tag.local === "row" && row <= OFFICE_PREVIEW_MAX_ROWS) {
      rows.set(row, cells);
      rowTags.set(row, rowTag);
    }
    if (depth === 2 && tag.local === "sheetData")
      dataEnd = emptyData ? parser.position : xml.lastIndexOf("<", parser.position - 1);
    if (cell?.reading === tag.local) cell.reading = "";
    depth--;
  });
  parser.write(xml).close();
  if (!dataStart) throw new Error("This workbook has no worksheet data.");
  const boundRange = (ref: string) => {
    const [a, b = a] = ref.split(":");
    const first = coordinate(a!);
    const last = coordinate(b!);
    if (first.col > OFFICE_PREVIEW_MAX_COLUMNS || first.line > OFFICE_PREVIEW_MAX_ROWS) return "";
    let letters = "";
    for (
      let col = Math.min(OFFICE_PREVIEW_MAX_COLUMNS, last.col);
      col > 0;
      col = Math.floor((col - 1) / 26)
    )
      letters = String.fromCharCode(65 + ((col - 1) % 26)) + letters;
    return a + ":" + letters + Math.min(OFFICE_PREVIEW_MAX_ROWS, last.line);
  };
  const metadata = (part: string) =>
    part.replace(
      /(<((?:\w+:)?(?:dimension|mergeCell|col))\b(?:[^"'<>]|"[^"]*"|'[^']*')*>)(?:\s*<\/\2\s*>)?/g,
      (tag: string, opening: string) => {
        const attributes = metadataAttributes.get(opening);
        if (!attributes) return tag;
        const replace = (name: string, value: string) => {
          const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*')`);
          tag = pattern.test(tag)
            ? tag.replace(pattern, ` ${name}="${value}"`)
            : tag.replace(/\/?>/, (end) => ` ${name}="${value}"${end}`);
        };
        if (attributes.ref !== undefined) {
          const bounded = boundRange(attributes.ref);
          if (!bounded) return "";
          replace("ref", bounded);
        }
        if (/<(?:\w+:)?col\b/.test(opening)) {
          const min = Math.max(1, Number(attributes.min ?? 1));
          const max = Math.min(OFFICE_PREVIEW_MAX_COLUMNS, Number(attributes.max ?? 16384));
          if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) return "";
          replace("min", String(min));
          replace("max", String(max));
        }
        return tag;
      },
    );
  return {
    xml: emptyData
      ? metadata(xml)
      : `${metadata(xml.slice(0, dataStart))}${[...rows]
          .sort(([a], [b]) => a - b)
          .map(
            ([line, values]) =>
              `${rowTags.get(line) ?? `<row r="${line}">`}${[...values]
                .sort(([a], [b]) => a - b)
                .map(([, value]) => value)
                .join("")}</${/^<([^\s>]+)/.exec(rowTags.get(line) ?? "<row>")![1]}>`,
          )
          .join("")}${metadata(xml.slice(dataEnd))}`,
    truncated,
    budget,
  };
}

async function boundWorkbook(archive: JSZip) {
  const paths = new Map<string, string>();
  let sharedPath = "xl/sharedStrings.xml";
  const relationships = xmlParser();
  relationships.on("opentag", (tag) => {
    if (tag.local !== "Relationship") return;
    const type = tag.attributes.Type?.value;
    const path = new URL(
      tag.attributes.Target?.value ?? "",
      "https://docx.invalid/xl/workbook.xml",
    ).pathname.slice(1);
    if (type?.endsWith("/worksheet")) paths.set(tag.attributes.Id?.value ?? "", path);
    if (type?.endsWith("/sharedStrings")) sharedPath = path;
  });
  relationships
    .write((await archive.file("xl/_rels/workbook.xml.rels")?.async("string")) ?? "")
    .close();
  const sheetPaths: string[] = [];
  const workbook = xmlParser();
  workbook.on("opentag", (tag) => {
    if (tag.local !== "sheet") return;
    const id = Object.values(tag.attributes).find((attribute) => attribute.local === "id")?.value;
    const path = paths.get(id ?? "");
    if (!path || sheetPaths.length === WORKBOOK_BUDGET.sheets)
      throw new Error("This workbook has invalid or too many sheets.");
    sheetPaths.push(path);
  });
  workbook.write((await archive.file("xl/workbook.xml")?.async("string")) ?? "").close();
  const strings: string[] = [];
  const shared = await archive.file(sharedPath)?.async("string");
  if (shared) {
    const parser = xmlParser();
    let text = "";
    let reading = false;
    parser.on("opentag", (tag) => {
      if (tag.local === "si") text = "";
      if (tag.local === "t") reading = true;
    });
    const readSharedText = (chunk: string) => {
      if (reading) text += chunk;
    };
    parser.on("text", readSharedText);
    parser.on("cdata", readSharedText);
    parser.on("closetag", (tag) => {
      if (tag.local === "t") reading = false;
      if (tag.local === "si") strings.push(text);
    });
    parser.write(shared).close();
  }
  let budget: WorksheetBudget = {
    remainingTextCharacters: WORKBOOK_BUDGET.textCharacters,
    usedCells: 0,
  };
  const limited = new Map<string, boolean>();
  for (const path of new Set(sheetPaths)) {
    const file = archive.file(path);
    if (!file) throw new Error("This workbook has a missing worksheet.");
    const sheet = boundedWorksheet(await file.async("string"), strings, budget);
    budget = sheet.budget;
    archive.file(path, sheet.xml);
    limited.set(path, sheet.truncated);
  }
  return sheetPaths.map((path) => limited.get(path) ?? false);
}
