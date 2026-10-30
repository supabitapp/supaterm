import { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { Atom, AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { useNextPromptSuggestion } from "./useNextPromptSuggestion";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  connected: true,
}));

vi.mock("~/state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: mocks.connected ? "connected" : "connecting" } }),
}));

vi.mock("~/state/orchestration", () => {
  const permission = Atom.make(true);
  return {
    orchestrationEnvironment: {
      suggestNextPrompt: {
        label: "suggest-next-prompt",
        permissionAtom: () => permission,
        run: mocks.run,
      },
    },
  };
});

function Suggestion({ run = "run-1" }: { run?: string }) {
  const { suggestion, dismiss } = useNextPromptSuggestion({
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    enabled: true,
    latestRun: {
      runId: RunId.make(run),
      status: "completed",
      requestedAt: "2026-10-01T00:00:00.000Z",
      startedAt: "2026-10-01T00:00:00.000Z",
      completedAt: "2026-10-01T00:01:00.000Z",
      assistantMessageId: null,
    },
  });
  return <button onClick={dismiss}>{suggestion ?? "No suggestion"}</button>;
}

it("waits for connection, dismisses a suggestion, and offers one for the next run", async () => {
  mocks.connected = false;
  mocks.run.mockReset().mockResolvedValue(AsyncResult.success({ suggestion: "Continue" }));
  await using screen = await render(<Suggestion />, { router: false });
  expect(mocks.run).not.toHaveBeenCalled();
  await expect.element(page.getByRole("button")).toHaveTextContent("No suggestion");

  mocks.connected = true;
  await screen.rerender(<Suggestion />);
  await expect.element(page.getByRole("button")).toHaveTextContent("Continue");
  await userEvent.click(page.getByRole("button"));
  await expect.element(page.getByRole("button")).toHaveTextContent("No suggestion");
  await screen.rerender(<Suggestion run="run-2" />);
  await expect.element(page.getByRole("button")).toHaveTextContent("Continue");
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it("ignores an old run's response after the current run changes", async () => {
  mocks.connected = true;
  let resolvePrevious!: (
    value: ReturnType<typeof AsyncResult.success<{ suggestion: string }>>,
  ) => void;
  const previous = new Promise<ReturnType<typeof AsyncResult.success<{ suggestion: string }>>>(
    (resolve) => {
      resolvePrevious = resolve;
    },
  );
  mocks.run
    .mockReset()
    .mockReturnValueOnce(previous)
    .mockResolvedValue(AsyncResult.success({ suggestion: "Current suggestion" }));
  await using screen = await render(<Suggestion />, { router: false });
  await screen.rerender(<Suggestion run="run-2" />);
  await expect.element(page.getByRole("button")).toHaveTextContent("Current suggestion");
  await act(async () => {
    resolvePrevious(AsyncResult.success({ suggestion: "Old suggestion" }));
    await previous;
  });
  await expect.element(page.getByRole("button")).toHaveTextContent("Current suggestion");
});
