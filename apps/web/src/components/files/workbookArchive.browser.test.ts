import { expect, it } from "vite-plus/test";
import { OFFICE_PREVIEW_MAX_COLUMNS, type OfficeWorkerResult } from "./officePreviewProtocol";

it.each([
  ["", "worksheets/./sheet1.xml", false],
  ["x:", "../xl/worksheets/sheet1.xml", false],
  ["", "/xl/worksheets/sheet1.xml", true],
])("preserves %sworksheet metadata with relationship target %s", async (prefix, target, empty) => {
  const { default: JSZip } = await import("jszip");
  const archive = new JSZip();
  const ns = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  archive.file(
    "xl/workbook.xml",
    '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet" sheetId="1" r:id="s"/></sheets></workbook>',
  );
  archive.file(
    "xl/_rels/workbook.xml.rels",
    `<Relationships><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/></Relationships>`,
  );
  archive.file(
    "xl/worksheets/sheet1.xml",
    `<${prefix}worksheet xmlns${prefix ? ":x" : ""}="${ns}"><${prefix}dimension ref="XFD1048576"/><${prefix}cols><${prefix}col min="${OFFICE_PREVIEW_MAX_COLUMNS - 1}" max="${OFFICE_PREVIEW_MAX_COLUMNS + 10}" width="20"/><${prefix}col min="${OFFICE_PREVIEW_MAX_COLUMNS + 1}" max="${OFFICE_PREVIEW_MAX_COLUMNS + 30}" hidden="1"/></${prefix}cols><${prefix}sheetData><${prefix}row ht="42" customHeight="1" hidden="1"><${prefix}c r="A50" t="inlineStr"><${prefix}is><${prefix}t>${"value".repeat(1000)}</${prefix}t></${prefix}is></${prefix}c></${prefix}row></${prefix}sheetData><${prefix}mergeCells><${prefix}mergeCell ref="XFD1048576"/></${prefix}mergeCells></${prefix}worksheet>`
      .replace(/<((?:x:)?(?:col|dimension|mergeCell))\b([^>]*)\/>/g, prefix ? "<$1$2></$1>" : "$&")
      .replace(/<sheetData>[\s\S]*?<\/sheetData>/, (data) => (empty ? "<sheetData/>" : data))
      .replace(/="([^"]*)"/g, (attribute, value: string) =>
        prefix || empty
          ? ` = '${value.replace(/\d/g, (digit) => `&#${digit.charCodeAt(0)};`)}'`
          : attribute,
      ),
  );
  const bytes = await archive.generateAsync({ type: "arraybuffer" });
  const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    const result = await new Promise<OfficeWorkerResult>((resolve) => {
      worker.addEventListener(
        "message",
        (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
        { once: true },
      );
      worker.postMessage({ type: "open", kind: "xlsx", bytes }, [bytes]);
    });
    expect(result.type).toBe("xlsx");
    if (result.type !== "xlsx") throw new Error("Expected bounded workbook");
    const bounded = await JSZip.loadAsync(result.bytes);
    const sheet = new DOMParser().parseFromString(
      await bounded.file("xl/worksheets/sheet1.xml")!.async("string"),
      "application/xml",
    );
    expect(sheet.querySelector("parsererror")).toBeNull();
    const row = sheet.getElementsByTagNameNS(ns, "row")[0];
    if (empty) expect(row).toBeUndefined();
    else {
      expect(row!.getAttribute("ht")).toBe("42");
      expect(row!.getAttribute("hidden")).toBe("1");
      expect(row!.getElementsByTagNameNS(ns, "c")[0]!.getAttribute("r")).toBe("A50");
      expect(row!.getElementsByTagNameNS(ns, "t")[0]!.textContent).toHaveLength(4096);
    }
    expect(sheet.getElementsByTagNameNS(ns, "dimension")).toHaveLength(0);
    expect(sheet.getElementsByTagNameNS(ns, "mergeCell")).toHaveLength(0);
    const columns = sheet.getElementsByTagNameNS(ns, "col");
    expect(columns).toHaveLength(1);
    expect(columns[0]!.getAttribute("min")).toBe(String(OFFICE_PREVIEW_MAX_COLUMNS - 1));
    expect(columns[0]!.getAttribute("max")).toBe(String(OFFICE_PREVIEW_MAX_COLUMNS));
  } finally {
    worker.terminate();
  }
});

it.each([false, true])(
  "bounds shared-string text including CDATA %s per cell and across sheets in the worker",
  async (cdata) => {
    const { default: JSZip } = await import("jszip");
    const archive = new JSZip();
    archive.file(
      "xl/workbook.xml",
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="one" sheetId="1" r:id="s"/><sheet name="two" sheetId="2" r:id="s"/></sheets></workbook>',
    );
    archive.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    const sharedPath = cdata ? "customStrings.xml" : "sharedStrings.xml";
    archive.file(
      "xl/_rels/workbook.xml.rels",
      (await archive.file("xl/_rels/workbook.xml.rels")!.async("string")).replace(
        "</Relationships>",
        `<Relationship Id="strings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="${sharedPath}"/></Relationships>`,
      ),
    );
    const content = "x".repeat(32_767);
    archive.file(
      `xl/${sharedPath}`,
      `<sst><si><t>${cdata ? `<![CDATA[${content}]]>` : content}</t></si></sst>`,
    );
    archive.file(
      "xl/worksheets/sheet1.xml",
      `<worksheet><sheetData>${Array.from({ length: 500 }, (_, i) => `<row r="${i + 1}">${Array.from({ length: 50 }, (_, j) => `<c r="${j < 26 ? String.fromCharCode(65 + j) : "A" + String.fromCharCode(65 + j - 26)}${i + 1}" t="s"><v>${cdata ? "<![CDATA[0]]>" : "0"}</v></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`.replace(
        '<c r="A1" t="s"><v><![CDATA[0]]></v></c>',
        `<c r="A1" t="inlineStr"><is><t><![CDATA[${content}]]></t></is></c>`,
      ),
    );
    const file = await archive.generateAsync({ type: "blob", compression: "DEFLATE" });
    const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      const result = await new Promise<OfficeWorkerResult>((resolve) => {
        worker.addEventListener(
          "message",
          (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
          { once: true },
        );
        void file
          .arrayBuffer()
          .then((bytes) => worker.postMessage({ type: "open", kind: "xlsx", bytes }, [bytes]));
      });
      expect(result.type).toBe("xlsx");
      if (result.type !== "xlsx") throw new Error("Expected bounded workbook");
      const bounded = await JSZip.loadAsync(result.bytes);
      const sheet = new DOMParser().parseFromString(
        await bounded.file("xl/worksheets/sheet1.xml")!.async("string"),
        "application/xml",
      );
      const cells = [...sheet.getElementsByTagName("t")].map((cell) => cell.textContent ?? "");
      expect(cells.reduce((total, cell) => total + cell.length, 0)).toBe(1024 * 1024);
      expect(Math.max(...cells.map((cell) => cell.length))).toBe(4096);
      expect(result.truncated).toBe(true);
    } finally {
      worker.terminate();
    }
  },
);

it.each(["XFD200", "XFD1048576", "AX500", "AZ9999999"])(
  "bounds spreadsheet cells at %s before padding",
  async (ref) => {
    const { default: JSZip } = await import("jszip");
    const archive = new JSZip();
    archive.file(
      "xl/workbook.xml",
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet" sheetId="1" r:id="rId1"/></sheets></workbook>',
    );

    archive.file(
      "xl/_rels/workbook.xml.rels",
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="custom.xml"/></Relationships>',
    );
    archive.file(
      "xl/custom.xml",
      `<worksheet><dimension ref="A1:${ref}"/><sheetData><row r="1"><c r="A1"><v>7</v></c></row><row r="${ref.replace(/\D/g, "")}"><c r="${ref}"><v>9</v></c></row></sheetData></worksheet>`,
    );
    const bytes = await archive.generateAsync({ type: "arraybuffer" });
    const worker = new Worker(new URL("./officePreview.worker.ts", import.meta.url), {
      type: "module",
    });
    try {
      const result = await new Promise<OfficeWorkerResult>((resolve) => {
        worker.addEventListener(
          "message",
          (event: MessageEvent<OfficeWorkerResult>) => resolve(event.data),
          { once: true },
        );
        worker.postMessage({ type: "open", kind: "xlsx", bytes }, [bytes]);
      });
      if (ref === "AZ9999999" || ref === "XFD1048576") {
        expect(result).toMatchObject({
          type: "error",
          message: expect.stringContaining(ref === "AZ9999999" ? "invalid" : "preview limit"),
        });
      } else {
        expect(result.type).toBe("xlsx");
        if (result.type !== "xlsx") throw new Error("Expected workbook values");
        const bounded = await JSZip.loadAsync(result.bytes);
        const sheet = new DOMParser().parseFromString(
          await bounded.file("xl/custom.xml")!.async("string"),
          "application/xml",
        );
        expect(sheet.querySelector('c[r="A1"] v')?.textContent).toBe("7");
        expect(sheet.querySelectorAll("row").length).toBeLessThanOrEqual(500);
        expect(result.truncated).toBe(ref !== "AX500");
        if (ref === "AX500") expect(sheet.querySelector('c[r="AX500"] v')?.textContent).toBe("9");
        else expect(sheet.querySelector('c[r="' + ref + '"]')).toBeNull();
      }
    } finally {
      worker.terminate();
    }
  },
);
