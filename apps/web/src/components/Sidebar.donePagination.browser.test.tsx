import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
// The thread route loads ChatView lazily; its first transform would eat the test's timeout.
import "~/components/ChatView";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import { getRouter } from "~/router";
import * as shelfHooks from "~/state/olderDoneShelf";
import {
  ENVIRONMENT_ID,
  installFakeEnvironment,
  threadWithHistory,
  type FakeDriver,
} from "../../test/fakeEnvironment";
import { act, render } from "../../test/render";

// The socket is the only fake layer; see test/appScenarios.renders.tsx.
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

vi.mock(import("~/state/olderDoneShelf"), async (original) => {
  const actual = await original();
  return { ...actual, useOlderDoneShelf: vi.fn(actual.useOlderDoneShelf) };
});

it("keeps Show more focused while older done threads load", async () => {
  const thread = threadWithHistory("thread-a", 1);
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  let loading = false;
  const retry = vi.fn(() => {
    loading = true;
  });
  const actualShelf = vi.mocked(shelfHooks.useOlderDoneShelf).getMockImplementation()!;
  using _shelf = vi.spyOn(shelfHooks, "useOlderDoneShelf").mockImplementation((input) => ({
    ...actualShelf(input),
    unloadedCount: () => 60,
    loading,
    retry,
  }));
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    // AppRoot brings its own router.
    router: false,
  });

  const doneShelf = page.getByRole("button", { name: "Done (60)" });
  await expect.element(doneShelf).toBeInTheDocument();
  await act(() => (doneShelf.element() as HTMLButtonElement).click());
  const more = page.getByRole("button", { name: "Show 25 more", exact: true });
  await expect.element(more).toBeInTheDocument();
  const moreButton = more.element() as HTMLButtonElement;
  moreButton.focus({ preventScroll: true });
  await act(() => moreButton.click());
  const loadingButton = page.getByRole("button", { name: "Loading", exact: true });
  await expect.element(loadingButton).toBeInTheDocument();

  // A disabled button loses focus on the browser's next frame; a real key press waits for it.
  await userEvent.keyboard("{Enter}");
  await expect.element(loadingButton).toHaveFocus();
  expect(retry).toHaveBeenCalledTimes(1);
});
