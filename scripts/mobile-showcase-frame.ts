// @effect-diagnostics nodeBuiltinImport:off - Host-side compositor renders store slides in a local browser.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeUtil from "node:util";

import { chromium, type Browser } from "playwright-core";

const FONT_DIRECTORY = NodePath.resolve(import.meta.dirname, "../apps/marketing/src/assets/fonts");

// Geometry is relative to the screen's shorter side. Bleeding devices run their
// bottom bezel off a portrait canvas; the others float whole.
const SHOWCASE_FRAMES = {
  iphone: { radius: 0.125, bezel: 0.026, cutout: "island", bleed: true },
  "iphone-duo": { radius: 0.075, bezel: 0.03, cutout: "none", bleed: false },
  ipad: { radius: 0.03, bezel: 0.026, cutout: "none", bleed: false },
  android: { radius: 0.09, bezel: 0.03, cutout: "punch-hole", bleed: true },
  "android-tablet": { radius: 0.045, bezel: 0.028, cutout: "none", bleed: false },
} as const satisfies Record<
  string,
  { radius: number; bezel: number; cutout: "island" | "punch-hole" | "none"; bleed: boolean }
>;
export type ShowcaseFrame = keyof typeof SHOWCASE_FRAMES;

export interface ShowcaseSlide {
  readonly eyebrow: string;
  // Two short lines; wrap the one accented word in *asterisks*.
  readonly title: readonly [string, string];
}

const CANVAS = {
  dark: {
    background: "#09090b",
    text: "#fafafa",
    muted: "#a1a1aa",
    accent: "oklch(0.74 0.15 250)",
    grid: "rgba(255, 255, 255, 0.05)",
    glow: "oklch(0.62 0.17 250 / 0.2)",
    rim: "#3f3f46",
    shadow: "rgba(0, 0, 0, 0.6)",
  },
  light: {
    background: "#f4f4f5",
    text: "#09090b",
    muted: "#52525b",
    accent: "oklch(0.55 0.2 255)",
    grid: "rgba(9, 9, 11, 0.06)",
    glow: "oklch(0.7 0.15 250 / 0.3)",
    rim: "#27272a",
    shadow: "rgba(9, 9, 11, 0.28)",
  },
} as const;

const GLOW_COLUMNS = [50, 30, 70, 38, 62];

export interface ShowcaseSlideInput {
  readonly width: number;
  readonly height: number;
  readonly frame: ShowcaseFrame;
  readonly appearance: keyof typeof CANVAS;
  readonly slide: ShowcaseSlide;
  readonly index: number;
  readonly capture: { readonly png: Buffer; readonly width: number; readonly height: number };
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (character) => `&#${character.charCodeAt(0)};`);

const titleHtml = (line: string) => escapeHtml(line).replace(/\*([^*]+)\*/g, "<em>$1</em>");

function showcaseSlideLayout(input: Omit<ShowcaseSlideInput, "slide" | "appearance">) {
  const { width, height, capture } = input;
  const portrait = height > width;
  const unit = Math.min(width, height) / 100;
  const eyebrowSize = unit * (portrait ? 2.7 : 2);
  const titleSize = unit * (portrait ? 9.6 : 6.6);
  const titleGap = unit * (portrait ? 2.4 : 1.6);
  const headTop = unit * (portrait ? 12 : 6.5);
  const titleLines = portrait ? 2 : 1;
  const headBottom = headTop + eyebrowSize * 1.2 + titleGap + titleLines * titleSize * 1.06;

  const frame = SHOWCASE_FRAMES[input.frame];
  const captureBezel = frame.bezel * Math.min(capture.width, capture.height);
  const deviceTop = headBottom + unit * (portrait ? 7 : 4.5);
  const margin = unit * (portrait ? 8 : 6);
  const scale =
    portrait && frame.bleed
      ? Math.min(
          (width * 0.84) / capture.width,
          (height - deviceTop) / (capture.height + captureBezel),
        )
      : Math.min(
          (width - 2 * margin) / (capture.width + 2 * captureBezel),
          (height - deviceTop - margin) / (capture.height + 2 * captureBezel),
        );
  const bezel = captureBezel * scale;
  const screenWidth = capture.width * scale;
  const screenHeight = capture.height * scale;
  const deviceWidth = screenWidth + 2 * bezel;
  return {
    portrait,
    unit,
    eyebrowSize,
    titleSize,
    titleGap,
    headTop,
    device: {
      left: (width - deviceWidth) / 2,
      top: deviceTop,
      bezel,
      screenWidth,
      screenHeight,
      radius: frame.radius * Math.min(screenWidth, screenHeight),
    },
  };
}

function slideHtml(input: ShowcaseSlideInput, fonts: { sans: string; mono: string }): string {
  const { width, height, slide } = input;
  const colors = CANVAS[input.appearance];
  const layout = showcaseSlideLayout(input);
  const { device, unit } = layout;
  const cutout = SHOWCASE_FRAMES[input.frame].cutout;
  const glowSize = Math.max(width, height) * 0.75;
  const glowLeft = (width * GLOW_COLUMNS[input.index % GLOW_COLUMNS.length]!) / 100 - glowSize / 2;
  const glowTop = device.top + device.screenHeight * 0.18 - glowSize / 2;
  const px = (value: number) => `${value.toFixed(2)}px`;
  const capture = `data:image/png;base64,${input.capture.png.toString("base64")}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:"DM Sans";src:url(data:font/woff2;base64,${fonts.sans}) format("woff2");font-weight:100 1000}
@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,${fonts.mono}) format("woff2");font-weight:100 800}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:${colors.background}}
body{position:relative;color:${colors.text};font-family:"DM Sans",sans-serif;-webkit-font-smoothing:antialiased;font-feature-settings:"ss01","ss02"}
.grid{position:absolute;inset:0;background-image:linear-gradient(to right,${colors.grid} 1px,transparent 1px),linear-gradient(to bottom,${colors.grid} 1px,transparent 1px);background-size:${px(unit * 5)} ${px(unit * 5)};background-position:center top;-webkit-mask-image:radial-gradient(ellipse 85% 50% at 50% 22%,#000 35%,transparent 100%)}
.glow{position:absolute;left:${px(glowLeft)};top:${px(glowTop)};width:${px(glowSize)};height:${px(glowSize)};background:radial-gradient(closest-side,${colors.glow},transparent)}
.head{position:absolute;left:0;right:0;top:${px(layout.headTop)};padding:0 ${px(unit * 6)};text-align:center}
.eyebrow{font-family:"JetBrains Mono",monospace;font-size:${px(layout.eyebrowSize)};line-height:1.2;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:${colors.muted}}
h1{margin-top:${px(layout.titleGap)};font-size:${px(layout.titleSize)};line-height:1.06;font-weight:560;letter-spacing:-.024em;white-space:nowrap}
h1 em{font-style:normal;color:${colors.accent}}
.device{position:absolute;left:${px(device.left)};top:${px(device.top)};padding:${px(device.bezel)};border-radius:${px(device.radius + device.bezel)};background:#0c0c0e;box-shadow:0 0 0 ${px(unit * 0.22)} ${colors.rim},inset 0 0 0 ${px(unit * 0.12)} rgba(255,255,255,.14),0 ${px(unit * 5)} ${px(unit * 12)} ${colors.shadow}}
.screen{position:relative;width:${px(device.screenWidth)};height:${px(device.screenHeight)};border-radius:${px(device.radius)};overflow:hidden;background:#000}
.screen img{display:block;width:100%;height:100%}
.island{position:absolute;left:50%;top:${px(device.screenWidth * 0.024)};width:${px(device.screenWidth * 0.28)};height:${px(device.screenWidth * 0.082)};transform:translateX(-50%);border-radius:999px;background:#000}
.punch-hole{position:absolute;left:50%;top:${px(device.screenWidth * 0.028)};width:${px(device.screenWidth * 0.036)};height:${px(device.screenWidth * 0.036)};transform:translateX(-50%);border-radius:50%;background:#000}
</style></head><body>
<div class="grid"></div><div class="glow"></div>
<div class="head"><div class="eyebrow">${escapeHtml(slide.eyebrow)}</div><h1>${slide.title.map(titleHtml).join(layout.portrait ? "<br>" : " ")}</h1></div>
<div class="device"><div class="screen"><img src="${capture}" alt="">${cutout === "none" ? "" : `<div class="${cutout}"></div>`}</div></div>
</body></html>`;
}

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export async function launchShowcaseBrowser(): Promise<Browser> {
  const require = NodeModule.createRequire(import.meta.url);
  const cli = NodePath.join(
    NodePath.dirname(require.resolve("playwright-core/package.json")),
    "cli.js",
  );
  await execFile(NodeProcess.execPath, [cli, "install", "chromium"]);
  return chromium.launch();
}

let fontsPromise: Promise<{ sans: string; mono: string }> | undefined;

export async function renderShowcaseSlide(
  browser: Browser,
  input: ShowcaseSlideInput,
): Promise<Buffer> {
  fontsPromise ??= Promise.all([
    NodeFSP.readFile(NodePath.join(FONT_DIRECTORY, "dm-sans-latin.woff2")),
    NodeFSP.readFile(NodePath.join(FONT_DIRECTORY, "jetbrains-mono-latin.woff2")),
  ]).then(([sans, mono]) => ({ sans: sans.toString("base64"), mono: mono.toString("base64") }));
  const page = await browser.newPage({
    viewport: { width: input.width, height: input.height },
    deviceScaleFactor: 1,
  });
  try {
    await page.setContent(slideHtml(input, await fontsPromise));
    const ready = await page.evaluate(`(async () => {
      await Promise.all([...document.images].map((image) => image.decode()));
      await document.fonts.ready;
      const title = document.querySelector("h1");
      return document.fonts.check('560 10px "DM Sans"') && document.fonts.check('500 10px "JetBrains Mono"')
        && title.scrollWidth <= title.clientWidth;
    })()`);
    if (ready !== true) {
      throw new Error(
        `Slide "${input.slide.title.join(" ")}" did not load its fonts or overflows its margins.`,
      );
    }
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}
