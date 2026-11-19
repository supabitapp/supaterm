import { BUILT_IN_THEMES } from "./builtInThemePalettes.ts";

export { BUILT_IN_THEMES };

export const BUILT_IN_THEME_IDS = [
  "midnight",
  "dracula",
  "one-dark-pro",
  "catppuccin-mocha",
  "tokyo-night",
  "nord",
  "github-dark",
  "github-dark-dimmed",
  "gruvbox-dark",
  "solarized-dark",
  "rose-pine",
  "night-owl",
  "kanagawa-wave",
  "paper",
  "one-light",
  "catppuccin-latte",
  "github-light",
  "gruvbox-light",
  "solarized-light",
  "rose-pine-dawn",
  "night-owl-light",
] as const;

const RETIRED_BUILT_IN_THEME_IDS = ["supaterm-chat", "grove", "ocean", "ember", "iris", "zenbones"];

export const MOBILE_DEFAULT_THEME_ID = "supaterm";

export const MOBILE_THEME_IDS = [MOBILE_DEFAULT_THEME_ID, ...BUILT_IN_THEME_IDS] as const;

/**
 * Ids a theme may not take: the appearance keywords a stored preference uses
 * and every built-in. Taking one would either be shadowed or
 * capture clients that never chose it, so the client library and the publish
 * path both consult this set.
 */
export const RESERVED_THEME_IDS: ReadonlySet<string> = new Set([
  "system",
  "light",
  "dark",
  ...BUILT_IN_THEME_IDS,
  ...RETIRED_BUILT_IN_THEME_IDS,
]);

/**
 * Additionally closed to a machine publishing a theme: the mobile default is
 * not a web or desktop built-in, so a saved theme may legitimately carry that
 * id, but no client that follows published themes can resolve it -- publishing
 * it would report success and change nothing.
 */
export const UNPUBLISHABLE_THEME_IDS: ReadonlySet<string> = new Set([
  ...RESERVED_THEME_IDS,
  MOBILE_DEFAULT_THEME_ID,
]);

export type BuiltInThemeId = (typeof BUILT_IN_THEME_IDS)[number];
export type MobileThemeId = (typeof MOBILE_THEME_IDS)[number];
export type ThemeAppearance = "light" | "dark";

export const THEME_COLOR_ROLES = [
  "canvas",
  "chrome",
  "toolbar",
  "toolbarForeground",
  "toolbarBorder",
  "toolbarControl",
  "toolbarControlForeground",
  "toolbarControlHover",
  "surface",
  "surfaceRaised",
  "surfaceOverlay",
  "text",
  "textMuted",
  "border",
  "input",
  "focus",
  "accent",
  "accentForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "placeholder",
  "secondaryLabel",
  "iconMuted",
  "error",
  "errorForeground",
  "errorSurface",
  "warning",
  "warningForeground",
  "warningSurface",
  "update",
  "updateForeground",
  "updateSurface",
  "accentSurface",
  "accentSurfaceForeground",
  "messageSurface",
  "messageForeground",
  "messageAction",
  "messageActionForeground",
  "messageActionHover",
  "codeBackground",
  "codeForeground",
  "searchMatchBackground",
  "searchMatchForeground",
  "searchMatchActiveBackground",
  "searchMatchActiveForeground",
  "sidebar",
  "sidebarForeground",
  "sidebarMutedForeground",
  "sidebarControlSurface",
  "sidebarRowHover",
  "sidebarRowActive",
  "sidebarRowSelected",
  "sidebarBorder",
  "terminalBackground",
  "terminalForeground",
  "terminalCursor",
  "terminalSelection",
  "terminalScrollbar",
  "terminalScrollbarHover",
] as const;

export type ThemeColorRole = (typeof THEME_COLOR_ROLES)[number];
export type ThemeColors = Readonly<Record<ThemeColorRole, string>>;
export type ThemeVariants = Readonly<Partial<Record<ThemeAppearance, ThemeColors>>>;
export type ThemeDefinition = Readonly<{
  id: string;
  label: string;
  appearance: ThemeAppearance;
  colors: ThemeColors;
  variants?: ThemeVariants;
  collection?: Readonly<{ id: string; label: string }>;
  managed?: boolean;
}>;

/** The standard Supaterm palette, Graphite in both appearances. */
export const SUPATERM_LIGHT_THEME_COLORS: ThemeColors = {
  searchMatchBackground: "oklch(0.910441 0.108498 88.529)",
  searchMatchForeground: "oklch(0.216164 0.028283 77.423)",
  searchMatchActiveBackground: "oklch(0.774202 0.151946 74.331)",
  searchMatchActiveForeground: "oklch(0.216164 0.028283 77.423)",
  canvas: "oklch(1 0 0)",
  chrome: "oklch(1 0 0)",
  toolbar: "oklch(1 0 0)",
  toolbarForeground: "oklch(0.273326 0.007496 274.683)",
  toolbarBorder: "oklch(0.926085 0.005368 286.294)",
  toolbarControl: "oklch(0.961716 0.002657 286.35)",
  toolbarControlForeground: "oklch(0.273326 0.007496 274.683)",
  toolbarControlHover: "oklch(0.943942 0.004005 286.323)",
  surface: "oklch(1 0 0)",
  surfaceRaised: "oklch(0.985383 0.00132 286.375)",
  surfaceOverlay: "oklch(1 0 0)",
  text: "oklch(0.273326 0.007496 274.683)",
  textMuted: "oklch(0.556507 0.004576 286.25)",
  border: "oklch(0.926085 0.005368 286.294)",
  input: "oklch(0.895646 0.005413 286.29)",
  focus: "oklch(0.722791 0.011722 274.832)",
  accent: "oklch(0.273326 0.007496 274.683)",
  accentForeground: "oklch(0.985104 0 0)",
  secondary: "oklch(0.961716 0.002657 286.35)",
  secondaryForeground: "oklch(0.273326 0.007496 274.683)",
  muted: "oklch(0.961716 0.002657 286.35)",
  mutedForeground: "oklch(0.525638 0.014257 275.896)",
  placeholder: "oklch(0.525638 0.014257 275.896)",
  secondaryLabel: "oklch(0.556507 0.004576 286.25)",
  iconMuted: "oklch(0.556507 0.004576 286.25)",
  error: "oklch(0.587696 0.197634 28.914)",
  errorForeground: "oklch(0.509494 0.208583 28.513)",
  errorSurface: "oklch(0.962058 0.014154 22.763)",
  warning: "oklch(0.641311 0.136361 67.774)",
  warningForeground: "oklch(0.474683 0.135757 44.981)",
  warningSurface: "oklch(0.969604 0.012424 75.368)",
  update: "oklch(0.618726 0.206728 259.232)",
  updateForeground: "oklch(0.487782 0.243225 264.405)",
  updateSurface: "oklch(0.952068 0.02289 258.359)",
  accentSurface: "oklch(0.943942 0.004005 286.323)",
  accentSurfaceForeground: "oklch(0.235659 0.007789 274.606)",
  messageSurface: "oklch(0.958712 0.002659 286.349)",
  messageForeground: "oklch(0.395825 0.011789 279.366)",
  messageAction: "oklch(0.273326 0.007496 274.683)",
  messageActionForeground: "oklch(0.985104 0 0)",
  messageActionHover: "oklch(0.360162 0.005312 271.268)",
  codeBackground: "oklch(0.976419 0.001323 286.375)",
  codeForeground: "oklch(0.273326 0.007496 274.683)",
  sidebar: "oklch(0.958712 0.002659 286.349)",
  sidebarForeground: "oklch(0.486506 0.012977 274.694)",
  sidebarMutedForeground: "oklch(0.525638 0.014257 275.896)",
  sidebarControlSurface: "oklch(0.931855 0.004018 286.321)",
  sidebarRowHover: "oklch(0.937903 0.004012 286.322)",
  sidebarRowActive: "oklch(0.920018 0.005377 286.293)",
  sidebarRowSelected: "oklch(0.910898 0.00539 286.292)",
  sidebarBorder: "oklch(0.926085 0.005368 286.294)",
  terminalBackground: "oklch(1 0 0)",
  terminalForeground: "oklch(0.294113 0.009137 276.812)",
  terminalCursor: "oklch(0.273326 0.007496 274.683)",
  terminalSelection: "oklch(0.915163 0.026001 266.602)",
  terminalScrollbar: "oklch(0.871403 0.006816 286.257)",
  terminalScrollbarHover: "oklch(0.786771 0.008492 278.6)",
};

export const SUPATERM_DARK_THEME_COLORS: ThemeColors = {
  searchMatchBackground: "oklch(0.549168 0.09987 84.95)",
  searchMatchForeground: "oklch(0.970151 0 0)",
  searchMatchActiveBackground: "oklch(0.774202 0.151946 74.331)",
  searchMatchActiveForeground: "oklch(0.216164 0.028283 77.423)",
  canvas: "oklch(0.235659 0.007789 274.606)",
  chrome: "oklch(0.235659 0.007789 274.606)",
  toolbar: "oklch(0.235659 0.007789 274.606)",
  toolbarForeground: "oklch(0.919248 0.005502 274.961)",
  toolbarBorder: "oklch(0.298565 0.010888 278.197)",
  toolbarControl: "oklch(0.269639 0.009345 276.757)",
  toolbarControlForeground: "oklch(0.919248 0.005502 274.961)",
  toolbarControlHover: "oklch(0.290498 0.010966 278.176)",
  surface: "oklch(0.252572 0.00765 274.644)",
  surfaceRaised: "oklch(0.265073 0.007555 274.669)",
  surfaceOverlay: "oklch(0.257195 0.00946 276.725)",
  text: "oklch(0.919248 0.005502 274.961)",
  textMuted: "oklch(0.647149 0.006013 274.92)",
  border: "oklch(0.298565 0.010888 278.197)",
  input: "oklch(0.334644 0.012312 279.249)",
  focus: "oklch(0.536085 0.014185 275.906)",
  accent: "oklch(0.919248 0.005502 274.961)",
  accentForeground: "oklch(0.213621 0.006075 271.124)",
  secondary: "oklch(0.269639 0.009345 276.757)",
  secondaryForeground: "oklch(0.919248 0.005502 274.961)",
  muted: "oklch(0.269639 0.009345 276.757)",
  mutedForeground: "oklch(0.641319 0.013545 275.981)",
  placeholder: "oklch(0.641319 0.013545 275.981)",
  secondaryLabel: "oklch(0.647149 0.006013 274.92)",
  iconMuted: "oklch(0.647149 0.006013 274.92)",
  error: "oklch(0.658019 0.191602 27.942)",
  errorForeground: "oklch(0.702184 0.189226 22.228)",
  errorSurface: "oklch(0.30294 0.036375 16.702)",
  warning: "oklch(0.764902 0.139882 72.95)",
  warningForeground: "oklch(0.829017 0.171221 81.038)",
  warningSurface: "oklch(0.327913 0.026043 73.975)",
  update: "oklch(0.618726 0.206728 259.232)",
  updateForeground: "oklch(0.704 0.158272 253.627)",
  updateSurface: "oklch(0.305734 0.053095 261.577)",
  accentSurface: "oklch(0.290498 0.010966 278.176)",
  accentSurfaceForeground: "oklch(0.960953 0.002879 264.542)",
  messageSurface: "oklch(0.290498 0.010966 278.176)",
  messageForeground: "oklch(0.840001 0.008352 278.613)",
  messageAction: "oklch(0.919248 0.005502 274.961)",
  messageActionForeground: "oklch(0.213621 0.006075 271.124)",
  messageActionHover: "oklch(0.857991 0.005599 274.954)",
  codeBackground: "oklch(0.252572 0.00765 274.644)",
  codeForeground: "oklch(0.919248 0.005502 274.961)",
  sidebar: "oklch(0.213621 0.006075 271.124)",
  sidebarForeground: "oklch(0.742075 0.011643 274.839)",
  sidebarMutedForeground: "oklch(0.641319 0.013545 275.981)",
  sidebarControlSurface: "oklch(0.269639 0.009345 276.757)",
  sidebarRowHover: "oklch(0.256756 0.007618 274.653)",
  sidebarRowActive: "oklch(0.290498 0.010966 278.176)",
  sidebarRowSelected: "oklch(0.277856 0.009272 276.777)",
  sidebarBorder: "oklch(0.273755 0.009308 276.767)",
  terminalBackground: "oklch(0.235659 0.007789 274.606)",
  terminalForeground: "oklch(0.89822 0.006869 277.154)",
  terminalCursor: "oklch(0.919248 0.005502 274.961)",
  terminalSelection: "oklch(0.357767 0.015754 275.646)",
  terminalScrollbar: "oklch(0.330731 0.01235 279.24)",
  terminalScrollbarHover: "oklch(0.418014 0.015129 275.764)",
};

export function getThemeColorsForAppearance(
  theme: ThemeDefinition,
  appearance: ThemeAppearance,
): ThemeColors | null {
  if (theme.appearance === appearance) return theme.colors;
  return theme.variants?.[appearance] ?? null;
}
