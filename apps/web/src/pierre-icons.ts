import { SUPATERM_FILE_ICON_SPRITE } from "./fileIconSprite.ts";
import {
  createFileTreeIconResolver,
  getBuiltInSpriteSheet,
  type FileTreeIcons,
} from "@pierre/trees";

import { VIDEO_FILE_EXTENSIONS } from "@supaterm/shared/video";
import { fileIconPathForMimeType } from "@supaterm/shared/mediaPreview";

import type { ContextChipAccentKind } from "~/lib/contextChipAccents";

export interface PierreIconResolution {
  name: string;
  token?: string;
}

const PIERRE_ICON_SPRITE_ID = "supaterm-pierre-file-icon-sprite";

export const SUPATERM_PIERRE_ICONS = {
  set: "complete",
  colored: true,
  spriteSheet: SUPATERM_FILE_ICON_SPRITE,
  byFileName: {
    "package.json": "file-tree-builtin-npm",
    "tsconfig.json": "file-tree-builtin-typescript",
    "agents.md": "supaterm-file-icon-agents",
    "pnpm-lock.yaml": "supaterm-file-icon-pnpm",
    "pnpm-workspace.yaml": "supaterm-file-icon-pnpm",
  },
  byFileExtension: {
    ...Object.fromEntries(
      VIDEO_FILE_EXTENSIONS.map((extension) => [extension, "supaterm-file-icon-video"]),
    ),
    pdf: "supaterm-file-icon-pdf",
    doc: "supaterm-file-icon-word",
    docx: "supaterm-file-icon-word",
    odt: "supaterm-file-icon-word",
    rtf: "supaterm-file-icon-word",
    xls: "supaterm-file-icon-spreadsheet",
    xlsx: "supaterm-file-icon-spreadsheet",
    ods: "supaterm-file-icon-spreadsheet",
    csv: "supaterm-file-icon-spreadsheet",
    tsv: "supaterm-file-icon-spreadsheet",
    ppt: "supaterm-file-icon-slides",
    pptx: "supaterm-file-icon-slides",
    odp: "supaterm-file-icon-slides",
    epub: "supaterm-file-icon-epub",
    cs: "supaterm-file-icon-csharp",
    csx: "supaterm-file-icon-csharp",
    dart: "supaterm-file-icon-dart",
    diff: "supaterm-file-icon-diff",
    patch: "supaterm-file-icon-diff",
    ex: "supaterm-file-icon-elixir",
    exs: "supaterm-file-icon-elixir",
    hs: "supaterm-file-icon-haskell",
    heic: "file-tree-builtin-image",
    heif: "file-tree-builtin-image",
    lhs: "supaterm-file-icon-haskell",
    java: "supaterm-file-icon-java",
    kt: "supaterm-file-icon-kotlin",
    kts: "supaterm-file-icon-kotlin",
    lua: "supaterm-file-icon-lua",
    luau: "supaterm-file-icon-lua",
    php: "supaterm-file-icon-php",
    ps1: "supaterm-file-icon-powershell",
    psm1: "supaterm-file-icon-powershell",
    psd1: "supaterm-file-icon-powershell",
    r: "supaterm-file-icon-r",
    scala: "supaterm-file-icon-scala",
    toml: "supaterm-file-icon-toml",
    xml: "supaterm-file-icon-xml",
    xsd: "supaterm-file-icon-xml",
    xsl: "supaterm-file-icon-xml",
    xslt: "supaterm-file-icon-xml",
  },
} satisfies FileTreeIcons;

const completeIconResolver = createFileTreeIconResolver(SUPATERM_PIERRE_ICONS);

const LANGUAGE_EXTENSION_ALIASES: Record<string, string> = {
  bash: "sh",
  csharp: "cs",
  elixir: "ex",
  haskell: "hs",
  javascript: "js",
  jsx: "jsx",
  kotlin: "kt",
  markdown: "md",
  mdx: "mdx",
  plaintext: "txt",
  powershell: "ps1",
  python: "py",
  ruby: "rb",
  rust: "rs",
  shell: "sh",
  shellscript: "sh",
  swift: "swift",
  typescript: "ts",
  tsx: "tsx",
  yaml: "yml",
};

export function basenameOfPath(pathValue: string): string {
  const slashIndex = pathValue.lastIndexOf("/");
  return slashIndex === -1 ? pathValue : pathValue.slice(slashIndex + 1);
}

const LANGUAGE_FILE_NAMES: Record<string, string> = {
  dockerfile: "Dockerfile",
};

export function syntheticFileNameForLanguageId(languageId: string): string {
  const normalized = languageId.toLowerCase();
  return (
    LANGUAGE_FILE_NAMES[normalized] ??
    `file.${LANGUAGE_EXTENSION_ALIASES[normalized] ?? normalized}`
  );
}

export function resolvePierreIconForEntry(
  pathValue: string,
  kind: "file" | "directory",
  mimeType?: string,
): PierreIconResolution | null {
  if (kind === "directory") return null;
  const icon = completeIconResolver.resolveIcon("file-tree-icon-file", pathValue);
  if (icon?.name === "file-tree-builtin-image" && icon.token === undefined)
    return { ...icon, token: "image" };
  return icon?.token === "default" && mimeType
    ? completeIconResolver.resolveIcon(
        "file-tree-icon-file",
        fileIconPathForMimeType(pathValue, mimeType),
      )
    : icon;
}

const DOCUMENT_CHIP_KINDS: Readonly<Record<string, ContextChipAccentKind>> = {
  "supaterm-file-icon-pdf": "doc-pdf",
  "supaterm-file-icon-word": "doc-word",
  "supaterm-file-icon-spreadsheet": "doc-spreadsheet",
  "supaterm-file-icon-slides": "doc-slides",
  "supaterm-file-icon-epub": "doc-epub",
};

export function documentChipKindForFileName(fileName: string) {
  const icon = resolvePierreIconForEntry(fileName, "file");
  return icon ? DOCUMENT_CHIP_KINDS[icon.name] : undefined;
}

export function hasSpecificPierreIconForFileName(fileName: string): boolean {
  return resolvePierreIconForEntry(fileName, "file")?.token !== "default";
}

export function ensurePierreIconSprite(): void {
  if (
    typeof document === "undefined" ||
    !document.body ||
    document.getElementById(PIERRE_ICON_SPRITE_ID)
  )
    return;
  const container = document.createElement("div");
  container.id = PIERRE_ICON_SPRITE_ID;
  container.setAttribute("aria-hidden", "true");
  container.style.position = "absolute";
  container.style.width = "0";
  container.style.height = "0";
  container.style.overflow = "hidden";
  container.style.pointerEvents = "none";
  container.innerHTML = `${getBuiltInSpriteSheet("complete")}${SUPATERM_FILE_ICON_SPRITE}`;
  document.body.prepend(container);
}
