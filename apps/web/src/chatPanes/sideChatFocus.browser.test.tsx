import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { openCommandPalette } from "~/commandPaletteBus";
import { useChatPaneStore } from "./store";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

// The fake server advertises no side chats; the gate is not what this covers.
vi.mock(import("~/components/chat/useSideChat"), async (original) => ({
  ...(await original()),
  useSideChatBlockedReason: () => null,
}));

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

const START_FROM = {
  palette: async () => {
    await act(() => openCommandPalette());
    await userEvent.keyboard("Start side chat");
    await userEvent.click(page.getByRole("option", { name: /Start side chat/ }));
  },
  composer: async () => {
    await userEvent.keyboard("/side what does this do?");
    await userEvent.keyboard("{Escape}{Enter}");
  },
};

it.each(Object.keys(START_FROM) as Array<keyof typeof START_FROM>)(
  "a side chat started from the %s focuses the message input in its own pane",
  async (from) => {
    useChatPaneStore.setState({
      layout: null,
      closed: [],
      parkedSideChats: [],
      openToSide: null,
      historyMode: "replace",
    });
    const parent = threadWithHistory("thread-a", 1);
    using _environment = installFakeEnvironment([parent], { acceptCommands: true });
    __setClientSettingsForTests({
      ...DEFAULT_CLIENT_SETTINGS,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    });
    await page.viewport(1600, 900);
    const router = getRouter(
      createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${parent.id}`] }),
    );
    await router.load();
    // AppRoot brings its own router.
    await using _app = await render(<AppRoot router={router} />, { router: false });
    const editors = () => document.querySelectorAll<HTMLElement>('[data-testid="composer-editor"]');
    await expect.element(page.getByTestId("composer-editor")).toBeVisible();
    await userEvent.click(page.getByTestId("composer-editor"));

    await START_FROM[from]();

    await expect.element(page.getByTestId("composer-editor").nth(1)).toBeVisible();
    await vi.waitFor(() => {
      const pane = document.activeElement?.closest<HTMLElement>("[data-chat-pane]");
      expect(pane?.dataset.focused).toBe("true");
      expect(pane).toBe(editors()[1]!.closest("[data-chat-pane]"));
      expect(editors()[1]!.contains(document.activeElement)).toBe(true);
    });
  },
);
