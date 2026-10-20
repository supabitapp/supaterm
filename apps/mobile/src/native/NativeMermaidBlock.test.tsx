import type { Diagram } from "@supaterm/mermaid/diagram";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { NativeMermaidBlock } from "./NativeMermaidBlock";
import type { NativeMarkdownTextStyle } from "./SelectableMarkdownText.types";

const { copy, navigate } = vi.hoisted(() => ({
  copy: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn(),
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate }) }));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  View: "View",
  Text: "Text",
  ScrollView: "ScrollView",
  Pressable: "Pressable",
}));
vi.mock("@supaterm/mobile-source-text", () => ({ SourceText: "SourceText" }));
vi.mock("expo-clipboard", () => ({ setStringAsync: copy }));
vi.mock("expo-haptics", () => ({ impactAsync: vi.fn(), ImpactFeedbackStyle: { Light: "light" } }));
vi.mock("../components/ui/AppSymbol", () => ({ SymbolView: "SymbolView" }));
vi.mock("../lib/useReducedMotionPreference", () => ({ useReducedMotionPreference: () => true }));
vi.mock("react-native-reanimated", () => ({
  default: { View: "View" },
  Easing: { out: (fn: unknown) => fn, cubic: () => {} },
  ReduceMotion: { Never: "never" },
  useSharedValue: (value: number) => ({ value, set: () => {} }),
  useAnimatedStyle: () => ({}),
  withTiming: (value: number) => value,
}));
vi.mock("./NativeMermaidSvg", () => ({ NativeMermaidSvg: "NativeMermaidSvg" }));
vi.mock("expo-symbols", () => ({ SymbolView: "SymbolView" }));

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
  skillTextColor: "black",
  quoteMarkerColor: "gray",
  dividerColor: "gray",
  fontSize: 14,
  lineHeight: 20,
  fontFamily: "sans-serif",
  headingFontFamily: "sans-serif",
  boldFontFamily: "sans-serif",
};

const diagram = (text: string): Diagram => ({
  svg: text,
  width: 100,
  height: 100,
  type: "flowchart",
});

let root: ReactTestRenderer | undefined;

async function render(
  source: string,
  renderer: ((source: string) => Promise<Diagram | null>) | null,
  style = textStyle,
) {
  const content = <NativeMermaidBlock source={source} textStyle={style} renderDiagram={renderer} />;
  await act(async () => {
    if (root) root.update(content);
    else root = create(content);
  });
  await act(async () =>
    root!.root
      .findByType("View" as never)
      .props.onLayout({ nativeEvent: { layout: { width: 360 } } }),
  );
}

function displayedText() {
  const svg = root!.root.findAllByType("NativeMermaidSvg" as never)[0];
  return svg ? svg.props.diagram.svg : root!.root.findByType("SourceText" as never).props.children;
}

async function press(label: string) {
  await act(async () => {
    root!.root
      .find(
        (node) => node.type === ("Pressable" as never) && node.props.accessibilityLabel === label,
      )
      .props.onPress();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  copy.mockClear();
  navigate.mockClear();
  vi.useFakeTimers();
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("NativeMermaidBlock", () => {
  it("keeps a working diagram when resizing fails and replaces it after recovery", async () => {
    const source = "flowchart LR\nA-->B";
    const renderer = vi
      .fn()
      .mockResolvedValueOnce(diagram("wide diagram"))
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("Renderer unavailable"))
      .mockResolvedValueOnce(diagram("narrow diagram"))
      .mockResolvedValue(null);
    await render(source, renderer);
    const resize = (width: number) =>
      act(async () =>
        root!.root
          .findByType("View" as never)
          .props.onLayout({ nativeEvent: { layout: { width } } }),
      );
    await resize(320);
    expect(displayedText()).toBe("wide diagram");
    await resize(280);
    expect(displayedText()).toBe("wide diagram");
    await resize(240);
    expect(displayedText()).toBe("narrow diagram");
    await render("invalid replacement", renderer);
    expect(displayedText()).toBe("invalid replacement");
  });

  it("shows the rendered diagram and copies Mermaid source from either view", async () => {
    const source = "graph LR\nA --> B";
    const renderer = vi.fn().mockResolvedValue(diagram("[A] --> [B]"));
    await render(source, renderer);
    expect(displayedText()).toBe("[A] --> [B]");
    await press("Copy Mermaid source");
    expect(copy).toHaveBeenLastCalledWith(source);
    await act(() => vi.advanceTimersByTime(1200));
    await press("View Mermaid source");
    expect(displayedText()).toBe(source);
    await press("Copy Mermaid source");
    expect(copy).toHaveBeenLastCalledWith(source);
    await press("View diagram");
    expect(displayedText()).toBe("[A] --> [B]");
    await render(source, renderer, { ...textStyle, codeColor: "white" });
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("opens the rendered diagram full screen", async () => {
    const source = "graph LR\nA --> B";
    const pending = Promise.withResolvers<Diagram>();
    await render(source, () => pending.promise);
    const expandButtons = () =>
      root!.root.findAll(
        (node) =>
          node.type === ("Pressable" as never) &&
          node.props.accessibilityLabel === "Open diagram full screen",
      );
    expect(expandButtons()).toHaveLength(0);
    await act(async () => pending.resolve(diagram("[A] --> [B]")));
    await press("Open diagram full screen");
    expect(navigate).toHaveBeenCalledWith("MermaidDiagram", { source });
  });

  it("keeps streaming source until rendering is enabled and ignores obsolete results", async () => {
    const pending = new Map<string, (value: Diagram) => void>();
    const renderer = vi.fn(
      (source: string) => new Promise<Diagram>((resolve) => pending.set(source, resolve)),
    );
    await render("first", null);
    expect(displayedText()).toBe("first");
    expect(renderer).not.toHaveBeenCalled();
    await render("first", renderer);
    await render("second", renderer);
    await act(() => pending.get("first")!(diagram("old diagram")));
    expect(displayedText()).toBe("second");
    await act(() => pending.get("second")!(diagram("new diagram")));
    expect(displayedText()).toBe("new diagram");
    await render("third", null);
    expect(displayedText()).toBe("third");
    expect(renderer).toHaveBeenCalledTimes(2);
  });

  it.each(["unsupported", "rejected"])("keeps %s input readable and copyable", async (failure) => {
    const renderer =
      failure === "unsupported"
        ? vi.fn().mockResolvedValue(null)
        : vi.fn().mockRejectedValue(new Error("invalid diagram"));
    await render("unsupported syntax", renderer);
    expect(displayedText()).toBe("unsupported syntax");
    expect(root!.root.findAllByProps({ accessibilityLabel: "View diagram" })).toHaveLength(0);
    await press("Copy Mermaid source");
    expect(copy).toHaveBeenLastCalledWith("unsupported syntax");
  });
});
