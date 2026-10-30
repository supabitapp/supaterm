import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { createRef, useImperativeHandle, type Ref } from "react";
import { expect, it } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { createPaneLayout } from "../../chatPanes/layout";
import { PaneScopeProvider } from "../../chatPanes/paneScope";
import { useChatPaneStore } from "../../chatPanes/store";
import {
  getWorkspaceFocusRequestVersion,
  startWorkspaceFocus,
  workspaceAreaProps,
} from "../../lib/workspaceFocus";
import { readThreadPreviewState } from "../../previewStateStore";
import { selectThreadPanelOpen, useRightPanelStore } from "../../rightPanelStore";
import { useRightPanelActions } from "./useRightPanelActions";

const threadRef = {
  environmentId: EnvironmentId.make("details-focus"),
  threadId: ThreadId.make("primary"),
};

function Details({
  presentation = "inline",
  routeKind = "server",
  actionRef,
}: {
  presentation?: "inline" | "popover";
  routeKind?: "server" | "draft";
  actionRef?: Ref<() => void>;
}) {
  const open = useRightPanelStore((state) =>
    selectThreadPanelOpen(state.threadPanelVisibilityByThreadKey, threadRef, presentation),
  );
  const actions = useRightPanelActions({
    routeKind,
    activeThreadRef: threadRef,
    activeProject: null,
    activeRightPanelSurface: null,
    activePreviewState: readThreadPreviewState(threadRef),
    deviceState: {
      hosts: [],
      hostStatus: "disabled",
      hostStatuses: {},
      devices: [],
      sessions: [],
      onboardingCompleted: false,
      agentAccessEnabled: false,
      hubBasePath: "/api/device-hub",
      revision: 0,
    },
    pullRequestPanelTarget: null,
    threadPanelPresentation: presentation,
    isServerThread: routeKind === "server",
    isGitRepo: false,
    browserAvailable: false,
    canOperatePreview: false,
    diffOpen: false,
    previewPanelOpen: false,
    rightPanelOpen: false,
    canMaximizeRightPanel: false,
    rightPanelMaximized: false,
    supportsPullRequests: false,
    pullRequestsSurfaceAvailable: false,
    gitCwd: null,
    activeProjectCwd: null,
    explicitDiffOpenRef: { current: null },
    onDiffPanelOpen: undefined,
    closeRightPanelSurface: () => {},
  });
  useImperativeHandle(actionRef, () => actions.toggleThreadPanelStable, [
    actions.toggleThreadPanelStable,
  ]);
  return (
    <>
      <button type="button" onClick={actions.toggleThreadPanelStable}>
        Toggle details
      </button>
      <section {...workspaceAreaProps("composer", 2, "Composer")}>
        <input aria-label="Message" />
      </section>
      {open && (
        <section {...workspaceAreaProps("details", 3, "Details")}>
          <button type="button" onClick={actions.toggleThreadPanelStable}>
            Close details
          </button>
        </section>
      )}
    </>
  );
}

function panelState() {
  const previousLayout = useChatPaneStore.getState().layout;
  const previousVisibility = useRightPanelStore.getState().threadPanelVisibilityByThreadKey;
  useChatPaneStore.setState({ layout: null });
  useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: {} });
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "inline", false);
  useRightPanelStore.getState().setThreadPanelOpen(threadRef, "popover", false);
  return {
    [Symbol.dispose]() {
      useChatPaneStore.setState({ layout: previousLayout });
      useRightPanelStore.setState({ threadPanelVisibilityByThreadKey: previousVisibility });
    },
  };
}

it("focuses newly opened inline details and returns to the composer when closed within details", async () => {
  using _state = panelState();
  await using screen = await render(
    <div data-chat-pane="active" data-focused="true">
      <PaneScopeProvider
        value={{
          paneId: "active",
          layoutVersion: "test",
          narrow: false,
          collapsed: false,
          element: null,
        }}
      >
        <Details />
      </PaneScopeProvider>
    </div>,
  );
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
  await screen.getByRole("button", { name: "Toggle details" }).click();
  const close = screen.getByRole("button", { name: "Close details" });
  await expect.element(close).toHaveFocus();
  const beforeClose = getWorkspaceFocusRequestVersion();
  await close.click();
  await expect.element(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  expect(getWorkspaceFocusRequestVersion()).toBe(beforeClose + 1);
});

it("keeps pointer focus on the outside toggle when closing inline details", async () => {
  using _state = panelState();
  await using screen = await render(<Details />);
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
  const toggle = screen.getByRole("button", { name: "Toggle details" });
  await toggle.click();
  await expect.element(screen.getByRole("button", { name: "Close details" })).toHaveFocus();
  const beforeClose = getWorkspaceFocusRequestVersion();
  await toggle.click();
  await expect.element(toggle).toHaveFocus();
  await expect
    .element(screen.getByRole("region", { name: "Details", exact: true }))
    .not.toBeInTheDocument();
  expect(getWorkspaceFocusRequestVersion()).toBe(beforeClose);
});

it("does not request workspace focus for popover details or draft routes", async () => {
  using _state = panelState();
  await using screen = await render(<Details presentation="popover" />);
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
  const before = getWorkspaceFocusRequestVersion();
  await screen.getByRole("button", { name: "Toggle details" }).click();
  await expect.element(screen.getByRole("button", { name: "Close details" })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Toggle details" })).toHaveFocus();
  expect(getWorkspaceFocusRequestVersion()).toBe(before);
  await screen.rerender(<Details routeKind="draft" />);
  await screen.getByRole("button", { name: "Toggle details" }).click();
  await expect
    .element(screen.getByRole("region", { name: "Details", exact: true }))
    .not.toBeInTheDocument();
  expect(getWorkspaceFocusRequestVersion()).toBe(before);
});

it("keeps another pane's focus when a background pane toggles details", async () => {
  using _state = panelState();
  let nextId = 0;
  const layout = createPaneLayout({ kind: "server", threadRef }, () => `pane-${nextId++}`);
  useChatPaneStore.setState({ layout });
  const backgroundId = layout.focusedPaneId;
  const foregroundId = useChatPaneStore.getState().split(backgroundId, "right", {
    kind: "server",
    threadRef: { ...threadRef, threadId: ThreadId.make("other") },
  })!;
  useChatPaneStore.getState().focus(foregroundId);
  const action = createRef<() => void>();
  await using screen = await render(
    <>
      <div data-chat-pane={backgroundId} data-focused="false">
        <PaneScopeProvider
          value={{
            paneId: backgroundId,
            layoutVersion: "test",
            narrow: false,
            collapsed: false,
            element: null,
          }}
        >
          <Details actionRef={action} />
        </PaneScopeProvider>
      </div>
      <div data-chat-pane={foregroundId} data-focused="true">
        <section {...workspaceAreaProps("composer", 2, "Other composer")}>
          <input aria-label="Other message" />
        </section>
        <section {...workspaceAreaProps("details", 3, "Other details")}>
          <button type="button">Other details action</button>
        </section>
      </div>
    </>,
  );
  using _focus = { [Symbol.dispose]: startWorkspaceFocus(screen.router!) };
  const other = screen.getByRole("textbox", { name: "Other message" });
  await other.click();
  const before = getWorkspaceFocusRequestVersion();
  await act(() => action.current?.());
  await expect.element(screen.getByRole("button", { name: "Close details" })).toBeVisible();
  await expect.element(other).toHaveFocus();
  expect(getWorkspaceFocusRequestVersion()).toBe(before);
  await screen.getByRole("button", { name: "Other details action" }).click();
  await act(() => action.current?.());
  await expect.element(screen.getByRole("button", { name: "Other details action" })).toHaveFocus();
  expect(getWorkspaceFocusRequestVersion()).toBe(before);
});
