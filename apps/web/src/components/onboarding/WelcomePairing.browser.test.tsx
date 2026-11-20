import { EnvironmentId } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";

const state = vi.hoisted(() => ({ connectPairing: vi.fn() }));

vi.mock(import("../../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.connectPairing) as never,
}));

import { WelcomePairing } from "./WelcomePairing";

const pairedId = EnvironmentId.make("paired");

function setup() {
  let settle!: () => void;
  state.connectPairing.mockReset().mockImplementation(
    () =>
      new Promise((resolve) => {
        settle = () => resolve(AsyncResult.success(pairedId));
      }),
  );
  return { settle: () => act(async () => settle()) };
}

async function pair(screen: Awaited<ReturnType<typeof render>>) {
  await userEvent.fill(
    screen.getByLabelText("Pairing link"),
    "https://example.test:5230/pair#token=abc",
  );
  await userEvent.click(screen.getByRole("button", { name: "Pair" }));
}

it("hands off the paired computer only while the page is still open", async () => {
  const pairing = setup();
  const onPaired = vi.fn();
  await using screen = await render(<WelcomePairing onPaired={onPaired} />, {
    router: "/welcome",
  });

  await pair(screen);
  await act(() => screen.router!.navigate({ to: "/settings/providers" }));
  await pairing.settle();
  expect(onPaired).not.toHaveBeenCalled();

  await act(() => screen.router!.navigate({ to: "/welcome" }));
  await pair(screen);
  await pairing.settle();
  expect(onPaired).toHaveBeenCalledWith(pairedId);
});
