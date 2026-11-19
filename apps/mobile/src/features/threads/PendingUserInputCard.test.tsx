import type { EnvironmentId, RuntimeRequestId, ThreadId } from "@supaterm/contracts";
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import type { PendingUserInput } from "../../lib/threadActivity";

const harness = vi.hoisted(() => ({
  navigate: [] as Array<[string, object | undefined]>,
  openedUrls: [] as string[],
}));

type Children = { children?: ReactNode };

vi.mock("react-native", () => ({
  AccessibilityInfo: { announceForAccessibility: () => {} },
  Keyboard: { dismiss: () => {} },
  Platform: { OS: "ios" },
  View: ({ children }: Children) => <div>{children}</div>,
  ScrollView: ({ children }: Children) => <div>{children}</div>,
  Pressable: ({ children, onPress }: Children & { onPress?: () => void }) => (
    <div onClick={onPress}>{children}</div>
  ),
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: ({ children }: Children) => <div>{children}</div> },
  Easing: { bezier: () => () => 0 },
  LayoutAnimationConfig: ({ children }: Children) => children,
  ReduceMotion: { System: "system" },
  useAnimatedStyle: () => ({}),
  useSharedValue: (value: number) => ({ value, get: () => value, set: () => {} }),
  withTiming: (value: number) => value,
}));
vi.mock("expo-haptics", () => ({}));
vi.mock("./QuestionAutoDismissTimer", () => ({
  QuestionAutoDismissToggle: (props: { children: (timer: ReactNode) => ReactNode }) =>
    props.children(null),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
vi.mock("../../components/ui/AppText", () => ({
  AppText: ({ children }: Children) => <span>{children}</span>,
}));
vi.mock("../../components/ui/ControlPill", () => ({ ControlPill: () => null }));
vi.mock("../../components/ui/Button", () => ({ Button: () => null }));
vi.mock("./QuestionAttachments", () => ({ QuestionAttachments: () => null }));
vi.mock("../files/FileMarkdownPreview", () => ({
  useMarkdownPreviewStyles: () => ({ nativeTextStyle: {} }),
}));
vi.mock("../../native/SelectableMarkdownText", () => ({
  SelectableMarkdownText: (props: { markdown: string; onLinkPress?: (href: string) => void }) => (
    <p>
      {[...props.markdown.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map(([, label, href]) => (
        <button key={href} type="button" onClick={() => props.onLinkPress?.(href!)}>
          {label}
        </button>
      ))}
    </p>
  ),
}));
vi.mock("../../state/entities", () => ({
  useLiveThreadLinkLabels: (markdown: string) => markdown,
}));
vi.mock("../../native/useOpenPullRequest", () => ({
  useOpenPullRequest: () => async (url: string) => {
    harness.openedUrls.push(url);
    return true;
  },
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: <Params extends object>(name: string, params?: Params) =>
      harness.navigate.push([name, params]),
  }),
}));

import { PendingUserInputCard } from "./PendingUserInputCard";

function setup(
  questionMarkdown: string,
  options: { readonly attachmentsPreparing?: boolean } = {},
) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.navigate = [];
  harness.openedUrls = [];
  const selectedOptions: string[] = [];

  const pendingUserInput = {
    requestId: "request-1" as RuntimeRequestId,
    responseCapability: "resumable",
    questions: [
      {
        id: "question-1",
        header: "Review",
        question: questionMarkdown,
        options: [{ label: "Red", description: "" }],
        allowCustomAnswer: false,
      },
    ],
  } as unknown as PendingUserInput;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <PendingUserInputCard
        environmentId={"env-1" as EnvironmentId}
        threadId={"thread-1" as ThreadId}
        workspaceRoot="/repo"
        canOperateThread
        pendingUserInput={pendingUserInput}
        maxHeight={{ value: 600 } as never}
        cardProgress={{ value: 1, set: () => {} } as never}
        cardCoverage={{ value: 0, set: () => {} } as never}
        collapsed={false}
        onToggleCollapsed={() => {}}
        drafts={
          options.attachmentsPreparing
            ? { "question-1": { attachmentsPreparing: true } as never }
            : {}
        }
        answers={null}
        respondingUserInputId={null}
        onSelectOption={(_requestId, _question, value) => selectedOptions.push(value)}
        onChangeCustomAnswer={() => {}}
        onPauseTimer={() => {}}
        onSubmit={async () => {}}
        onDismiss={async () => {}}
      />,
    ),
  );
  return {
    selectedOptions,
    pressOption(label: string) {
      const option = [...container.querySelectorAll("div")].findLast(
        (element) => element.onclick !== null && element.textContent?.startsWith(label),
      );
      if (!option) throw new Error(`No option labelled ${label}`);
      act(() => option.click());
    },
    async pressLink(label: string) {
      const link = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === label,
      );
      if (!link) throw new Error(`No link labelled ${label}`);
      await act(async () => link.click());
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

it("opens a workspace file link in a question in the thread's file viewer", async () => {
  using screen = setup("Should I update [probe.md](docs/probe.md:12)?");

  await screen.pressLink("probe.md");

  expect(harness.openedUrls).toEqual([]);
  expect(harness.navigate).toEqual([
    [
      "ThreadFile",
      { environmentId: "env-1", threadId: "thread-1", path: ["docs", "probe.md"], line: "12" },
    ],
  ]);
});

it("ignores an option while the answer field is still preparing", () => {
  using ready = setup("Which color?");
  ready.pressOption("Red");
  expect(ready.selectedOptions).toEqual(["Red"]);

  using preparing = setup("Which color?", { attachmentsPreparing: true });
  preparing.pressOption("Red");
  expect(preparing.selectedOptions).toEqual([]);
});
