import { enumerateDays } from "@supaterm/shared/usageFormat";
import { mergeUsage, type DailyTotals } from "@supaterm/shared/usageMerge";
import type { ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { UsageChartCard } from "./UsageChartCard";

vi.mock("react-native", () => ({ Pressable: "Pressable", View: "View" }));
vi.mock("react-native-svg", () => ({ default: "Svg", Line: "Line" }));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: ({ children }: { readonly children: ReactNode }) => children,
  usePanGesture: () => ({}),
}));
vi.mock("react-native-reanimated", () => ({
  runOnJS: <T,>(fn: T) => fn,
  useSharedValue: (initial: number) => {
    let value = initial;
    return { get: () => value, set: (next: number) => (value = next) };
  },
}));
vi.mock("expo-haptics", () => ({ selectionAsync: vi.fn(async () => undefined) }));
vi.mock("../../components/ui/AppText", () => ({ AppText: "Text" }));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));

let renderer: ReactTestRenderer | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

function card(sinceDay: string, untilDay: string, costUsd: number) {
  const days = enumerateDays(sinceDay, untilDay);
  const daily: DailyTotals[] = days.map((day) => ({
    day,
    costUsd,
    totalTokens: costUsd,
    byProvider: new Map([["codex", { costUsd, totalTokens: costUsd }]]),
  }));
  return (
    <UsageChartCard
      merged={mergeUsage([], 1)}
      days={days}
      daily={daily}
      metric="cost"
      sinceDay={sinceDay}
      untilDay={untilDay}
      isPast24Hours={false}
      timeZone="UTC"
      height={160}
    />
  );
}

async function show(element: ReturnType<typeof card>) {
  await act(() => {
    if (renderer === null) renderer = create(element);
    else renderer.update(element);
  });
}

function header() {
  return renderer?.root.findAllByType("Text" as never)[0]?.props.children;
}

async function pressDay(label: string) {
  const cell = renderer?.root.find(
    (node) =>
      node.type === ("Pressable" as never) &&
      String(node.props.accessibilityLabel).startsWith(`${label},`),
  );
  await act(() => cell?.props.onPress());
}

async function adjust(actionName: "increment" | "decrement") {
  const chart = renderer?.root.find((node) => node.props.accessibilityRole === "adjustable");
  await act(() => chart?.props.onAccessibilityAction({ nativeEvent: { actionName } }));
}

it("drops a picked day when the window changes or the data has no activity", async () => {
  await show(card("2026-08-06", "2026-11-03", 5));
  await pressDay("Oct 3");
  expect(header()).toBe("Oct 3");

  await show(card("2026-08-06", "2026-11-03", 0));
  expect(header()).toBe("Raw token cost");

  await show(card("2026-08-06", "2026-11-03", 5));
  await pressDay("Oct 20");
  await show(card("2026-10-05", "2026-11-03", 5));
  expect(header()).toBe("Raw token cost");
});

it("steps the bar chart selection with accessibility adjust actions", async () => {
  await show(card("2026-10-28", "2026-11-03", 5));

  await adjust("increment");
  expect(header()).toBe("Nov 3 so far");
  await adjust("decrement");
  expect(header()).toBe("Nov 2");
  await adjust("increment");
  await adjust("increment");
  expect(header()).toBe("Nov 3 so far");
});
