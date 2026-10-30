import { getResolvedOrResolveTheme, registerCustomTheme, type DiffsTheme } from "@pierre/diffs";

export const READABLE_LIGHT_THEME_NAME = "supaterm-light";

const MIN_CONTRAST = 4.5;
const DARKEST_SURFACE_LUMINANCE = 0.69;

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function contrastOnLightCode(rgb: readonly [number, number, number]): number {
  const [r, g, b] = rgb.map(channelLuminance) as [number, number, number];
  return (DARKEST_SURFACE_LUMINANCE + 0.05) / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

export function readableOnLightCode(color: string, minContrast = MIN_CONTRAST): string {
  const match = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!match) return color;
  let rgb = [0, 2, 4].map((start) => Number.parseInt(match[1]!.slice(start, start + 2), 16)) as [
    number,
    number,
    number,
  ];
  if (contrastOnLightCode(rgb) >= minContrast) return color;
  while (contrastOnLightCode(rgb) < minContrast) {
    rgb = rgb.map((channel) => Math.floor(channel * 0.96)) as [number, number, number];
  }
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}${match[2] ?? ""}`;
}

type ZedTheme = NonNullable<DiffsTheme["zed"]>;

const FURTHER_COLORS = new Set(["#1ca1c7", "#636363", "#1a85d4"]);
const FURTHER_MIN_CONTRAST = 6;

export function readableSyntaxColor(color: string): string {
  return readableOnLightCode(
    color,
    FURTHER_COLORS.has(color.toLowerCase()) ? FURTHER_MIN_CONTRAST : MIN_CONTRAST,
  );
}

function withReadableSyntax(theme: ZedTheme): ZedTheme {
  const syntax = Object.fromEntries(
    Object.entries(theme.style.syntax ?? {}).map(([scope, style]) => [
      scope,
      typeof style === "string"
        ? readableSyntaxColor(style)
        : style.color
          ? { ...style, color: readableSyntaxColor(style.color) }
          : style,
    ]),
  );
  return { ...theme, name: READABLE_LIGHT_THEME_NAME, style: { ...theme.style, syntax } };
}

registerCustomTheme(
  READABLE_LIGHT_THEME_NAME,
  async () => {
    const base = await getResolvedOrResolveTheme("pierre-light", "highlights");
    if (!base.zed) throw new Error("pierre-light has no Highlights palette");
    return withReadableSyntax(base.zed);
  },
  "zed",
);

registerCustomTheme(READABLE_LIGHT_THEME_NAME, async () => {
  const base = await getResolvedOrResolveTheme("pierre-light", "shiki-wasm");
  if (!base.textmate) throw new Error("pierre-light has no TextMate palette");
  return {
    ...base.textmate,
    name: READABLE_LIGHT_THEME_NAME,
    settings: base.textmate.settings.map((rule) => ({
      ...rule,
      settings: rule.settings.foreground
        ? { ...rule.settings, foreground: readableSyntaxColor(rule.settings.foreground) }
        : rule.settings,
    })),
  };
});
