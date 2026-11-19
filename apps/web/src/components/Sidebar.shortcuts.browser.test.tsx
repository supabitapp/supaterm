import { createMemoryHistory } from "@tanstack/react-router";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { useRightPanelStore } from "~/rightPanelStore";
import { getRouter } from "~/router";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, fakeTimers, render } from "../../test/render";
import { isMacPlatform } from "@supaterm/shared/keybindings";
import { THREAD_JUMP_HINT_SHOW_DELAY_MS } from "./Sidebar.logic";

vi.mock("../../../../packages/client-runtime/src/connection/driver.ts", async (importOriginal) => {
  const [actual, { fakeDriver }, Layer] = await Promise.all([
    importOriginal<{ readonly ConnectionDriver: Context.Key<unknown, FakeDriver> }>(),
    import("../../test/fakeEnvironment"),
    import("effect/Layer"),
  ]);
  return { ...actual, layer: Layer.succeed(actual.ConnectionDriver, fakeDriver) };
});

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

vi.mock(import("~/state/server"), async (original) => {
  const actual = await original();
  const { Atom } = await import("effect/reactivity");
  const { compileResolvedKeybindingsConfig } = await import("@supaterm/shared/keybindings");
  const keybindings = compileResolvedKeybindingsConfig([
    { key: "mod+shift+]", command: "thread.next", when: "!previewFocus && !previewOpen" },
    { key: "mod+1", command: "thread.jump.1", when: "!previewFocus" },
  ]);
  return { ...actual, primaryServerKeybindingsAtom: Atom.make(keybindings) };
});

it("leaves thread shortcuts and their hints to the preview when their rules exclude it", async () => {
  const [first, second] = [threadWithHistory("thread-a", 1), threadWithHistory("thread-b", 1)];
  using _environment = installFakeEnvironment([first, second]);
  const mod = isMacPlatform(navigator.platform) ? "Meta" : "Control";
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${first.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    router: false,
  });
  await expect.element(page.getByText(`Thread ${second.id}`).first()).toBeVisible();

  const previewChrome = document.createElement("div");
  previewChrome.dataset.previewPanelMode = "browser";
  previewChrome.innerHTML = '<button type="button">Reload</button>';
  document.body.append(previewChrome);
  using _chrome = { [Symbol.dispose]: () => previewChrome.remove() };

  const press = () => userEvent.keyboard(`{${mod}>}{Shift>}]{/Shift}{/${mod}}`);
  const jumpHint = () => document.querySelector("[data-jump-hint]");
  const whileHoldingControl = async (assertJumpHints: () => void) => {
    using _timers = fakeTimers();
    await userEvent.keyboard(`{${mod}>}`);
    await act(() => vi.advanceTimersByTime(THREAD_JUMP_HINT_SHOW_DELAY_MS));
    assertJumpHints();
    await userEvent.keyboard(`{/${mod}}`);
  };
  const firstPath = `/${ENVIRONMENT_ID}/${first.id}`;

  await userEvent.click(page.getByRole("button", { name: "Reload" }));
  await press();
  expect(router.history.location.pathname).toBe(firstPath);
  await whileHoldingControl(() => expect(jumpHint()).toBeNull());

  const firstRef = scopeThreadRef(ENVIRONMENT_ID, first.id);
  await act(() => useRightPanelStore.getState().openBrowser(firstRef, null));
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await press();
  expect(router.history.location.pathname).toBe(firstPath);

  await act(() => useRightPanelStore.getState().close(firstRef));
  await press();
  await vi.waitFor(() =>
    expect(router.history.location.pathname).toBe(`/${ENVIRONMENT_ID}/${second.id}`),
  );
  await whileHoldingControl(() => expect(jumpHint()).not.toBeNull());
});
