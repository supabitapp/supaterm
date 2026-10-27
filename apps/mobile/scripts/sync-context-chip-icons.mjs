import * as NodeFS from "node:fs";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const scriptDirectory = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const appDirectory = NodePath.resolve(scriptDirectory, "..");
const repositoryRoot = NodePath.resolve(appDirectory, "../..");
const outputDirectory = NodePath.join(appDirectory, "assets/context-chip-icons");
const generatedModulePath = NodePath.join(appDirectory, "src/lib/contextChipIcons.generated.ts");

const requireFromScripts = NodeModule.createRequire(
  NodePath.join(repositoryRoot, "scripts/package.json"),
);
const sharp = requireFromScripts("sharp");
const icons = await import(
  NodeURL.pathToFileURL(NodePath.join(repositoryRoot, "packages/icons/src/nodes.ts")).href
);

const chipIcons = [
  "circle-dashed",
  "film",
  "git-merge",
  "git-pull-request",
  "git-pull-request-closed",
  "git-pull-request-draft",
  "image",
  "message-circle",
  "messages-square",
  "mouse-pointer-click",
  "terminal",
];

const exportName = (token) =>
  token
    .split("-")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");

// The skill chip draws the same glyph and stroke as SKILL_CHIP_ICON_SVG on web.
function iconSvg(node, strokeWidth = 2) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${icons.iconSvgElements(node)}</svg>`;
}

async function renderIcon(token, svg) {
  const sized = svg
    .replace(/^<svg[^>]*?>/, (tag) =>
      tag
        .replace(/ (?:width|height)="[^"]*"/g, "")
        .replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" '),
    )
    .replaceAll("currentColor", "#ffffff");
  await sharp(Buffer.from(sized), { density: 72 * (64 / 24) })
    .resize(64, 64)
    .png()
    .toFile(NodePath.join(outputDirectory, `${token}.png`));
}

NodeFS.rmSync(outputDirectory, { recursive: true, force: true });
NodeFS.mkdirSync(outputDirectory, { recursive: true });

for (const token of chipIcons) {
  const node = icons[exportName(token)];
  if (!node) throw new Error(`@supaterm/icons has no ${exportName(token)} for the ${token} chip`);
  await renderIcon(token, iconSvg(node));
}
await renderIcon("skill", iconSvg(icons.Box, 1.85));

const tokens = [...chipIcons, "skill"].sort();
const generatedSource = `import type { ImageSourcePropType } from "react-native";\n\nexport const CONTEXT_CHIP_ICON_SOURCES = {\n${tokens
  .map(
    (token) =>
      `  ${/^\w+$/.test(token) ? token : `"${token}"`}: require("../../assets/context-chip-icons/${token}.png"),`,
  )
  .join("\n")}\n} as const satisfies Readonly<Record<string, ImageSourcePropType>>;\n`;
NodeFS.writeFileSync(generatedModulePath, generatedSource);
