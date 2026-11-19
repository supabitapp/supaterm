import { createMemoryHistory } from "@tanstack/react-router";
import { DEFAULT_CLIENT_SETTINGS } from "@supaterm/contracts/settings";
import type * as Context from "effect/Context";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { AppRoot } from "~/AppRoot";
import "~/components/ChatView";
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

vi.mock(import("~/rpc/requestLatencyState"), async (original) => ({
  ...(await original()),
  trackRpcRequestSent: () => {},
}));

type Shelf = ReturnType<typeof import("~/state/olderDoneShelf").useOlderDoneShelf>;
const shelf = vi.hoisted(() => ({ overrides: null as Partial<Shelf> | null }));
vi.mock(import("~/state/olderDoneShelf"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useOlderDoneShelf: (input) => ({ ...actual.useOlderDoneShelf(input), ...shelf.overrides }),
  };
});

it("keeps Show more focused while older done threads load", async () => {
  const thread = threadWithHistory("thread-a", 1);
  using _environment = installFakeEnvironment([thread]);
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  });
  let loading = false;
  const retry = vi.spyOn(
    {
      retry: () => {
        loading = true;
      },
    },
    "retry",
  );
  const overrides = {
    unloadedCount: () => 60,
    get loading() {
      return loading;
    },
    retry,
  };
  shelf.overrides = overrides;
  using _shelf = { [Symbol.dispose]: () => void (shelf.overrides = null) };
  await page.viewport(1400, 900);
  const router = getRouter(
    createMemoryHistory({ initialEntries: [`/${ENVIRONMENT_ID}/${thread.id}`] }),
  );
  await router.load();
  await using _app = await render(<AppRoot router={router} />, {
    router: false,
  });

  await expect.element(page.getByTestId("composer-editor")).toHaveFocus();
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

  await userEvent.keyboard("{Enter}");
  await expect.element(loadingButton).toHaveFocus();
  expect(retry).toHaveBeenCalledTimes(1);
});
