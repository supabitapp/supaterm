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

function iconSvg(node) {
  return `<svg viewBox="0 0 24 24" ${icons.ICON_SVG_ROOT_ATTRIBUTES}>${icons.iconSvgElements(node)}</svg>`;
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
await renderIcon("skill", iconSvg(icons.Box));

const tokens = [...chipIcons, "skill"].sort();
const generatedSource = `import type { ImageSourcePropType } from "react-native";\n\nexport const CONTEXT_CHIP_ICON_SOURCES = {\n${tokens
  .map(
    (token) =>
      `  ${/^\w+$/.test(token) ? token : `"${token}"`}: require("../../assets/context-chip-icons/${token}.png"),`,
  )
  .join("\n")}\n} as const satisfies Readonly<Record<string, ImageSourcePropType>>;\n`;
NodeFS.writeFileSync(generatedModulePath, generatedSource);

const nativeDirectory = NodePath.join(appDirectory, "assets/icons");
for (const [name, node] of Object.entries({
  compose: icons.SquarePen,
  delete: icons.Trash,
  "chevron-down": icons.ChevronDown,
})) {
  NodeFS.writeFileSync(
    NodePath.join(nativeDirectory, `${name}.xml`),
    `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="${node}" />
</vector>
`,
  );
}
for (const [path, node] of [
  ["assets/icons/file-diff", icons.Diff],
  ["modules/supaterm-native-controls/ios/Resources/Icons/pull-request", icons.GitPullRequest],
]) {
  const svg = iconSvg(node).replaceAll("currentColor", "#000000");
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? "" : `@${scale}x`;
    await sharp(Buffer.from(svg))
      .resize(24 * scale, 24 * scale)
      .png()
      .toFile(NodePath.join(appDirectory, `${path}${suffix}.png`));
  }
}
