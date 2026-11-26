import { act, type ReactElement } from "react";
import { create } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

import { MobileEnrichedMarkdownText } from "./EnrichedMarkdownText";
import type { NativeMarkdownTextStyle } from "./SelectableMarkdownText.types";

vi.mock("gt-react-native", async (importOriginal) => ({
  ...(await importOriginal<typeof import("gt-react-native")>()),
  useGT: () => (text: string) => `[de] ${text}`,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Share: { share: vi.fn() },
  StyleSheet: { hairlineWidth: 1 },
  useWindowDimensions: () => ({ fontScale: 1 }),
  View: "View",
}));
vi.mock("react-native-enriched-markdown", () => ({ EnrichedMarkdownText: "EnrichedMarkdownText" }));
vi.mock("../features/settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light", mathRenderingEnabled: true }),
}));
vi.mock("../components/ui/Menu", () => ({ Menu: "Menu" }));
vi.mock("../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: vi.fn() }));
vi.mock("../lib/enrichedLinkPresentation", () => ({
  ENRICHED_INLINE_FILE_LINK_REGEX: /(?!)/,
  enrichedSkillLinkRegex: () => null,
  enrichedLinkVariantPattern: (url: string) => url,
}));
vi.mock("./HighlightedCodeBlock", () => ({ HighlightedCodeBlock: "HighlightedCodeBlock" }));
vi.mock("./NativeMermaidBlock", () => ({ NativeMermaidBlock: "NativeMermaidBlock" }));
vi.mock("./useEnrichedLinkVariants", () => ({
  useEnrichedLinkVariants: () => ({ linkVariants: undefined, linkPillContent: undefined }),
}));
vi.mock("./useRetryingImageSource", () => ({ useRetryingImageSource: () => undefined }));

const textStyle: NativeMarkdownTextStyle = {
  color: "black",
  strongColor: "black",
  mutedColor: "gray",
  linkColor: "blue",
  inlineCodeColor: "black",
  codeColor: "black",
  codeBackgroundColor: "white",
  codeBlockBackgroundColor: "white",
  fileTextColor: "black",
  quoteMarkerColor: "gray",
  dividerColor: "gray",
  fontSize: 14,
  lineHeight: 20,
  fontFamily: "sans-serif",
  headingFontFamily: "sans-serif",
  boldFontFamily: "sans-serif",
};

it("gives the native renderer its selection menu and screen reader labels in the UI language", async () => {
  const root = await act(async () =>
    create(<MobileEnrichedMarkdownText markdown="- item" textStyle={textStyle} />),
  );
  const response = root.root.findByType("EnrichedMarkdownText" as never).props;
  const math = (
    response.renderers.code({ language: "math", code: "x^2", isComplete: true }) as ReactElement<
      typeof response
    >
  ).props;
  const translated = {
    selectionMenuConfig: { copyAsMarkdown: { label: "[de] Copy as Markdown" } },
    accessibilityLabels: { list: { bulletPoint: "[de] Bullet point" } },
  };

  expect(response).toMatchObject(translated);
  expect(math).toMatchObject(translated);
});
