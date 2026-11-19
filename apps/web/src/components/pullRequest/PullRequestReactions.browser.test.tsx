import { EnvironmentId, ProjectId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";

const { fake } = vi.hoisted(() => ({
  fake: <
    F extends (...args: never[]) => unknown = { call(...args: Array<unknown>): unknown }["call"],
  >(
    initial?: F,
  ) => {
    const script = { queue: [] as Array<F>, fallback: initial };
    const target = {
      call: (...args: Parameters<F>) =>
        (script.queue.shift() ?? script.fallback)?.(...args) as ReturnType<F>,
    };
    const spy = vi.spyOn(target, "call");
    const scripted = Object.assign(spy, {
      implement: (next: F) => {
        script.fallback = next;
        return scripted;
      },
      implementOnce: (next: F) => {
        script.queue.push(next);
        return scripted;
      },
      reset: (next?: F) => {
        script.queue = [];
        script.fallback = next ?? initial;
        spy.mockClear();
        return scripted;
      },
    });
    return scripted;
  },
}));
const state = vi.hoisted(() => ({ send: fake() }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.send }));
vi.mock("~/state/pullRequests", () => ({ pullRequestEnvironment: { setReaction: {} } }));

import { PullRequestReactionBar } from "./PullRequestReactions";

it("keeps the latest reaction choice when an older toggle fails", async () => {
  state.send.reset();
  let failFirst = () => {};
  let finishLater = () => {};
  state.send
    .implementOnce(() => new Promise((resolve) => (failFirst = () => resolve({ _tag: "Failure" }))))
    .implement(
      () =>
        new Promise(
          (resolve) => (finishLater = () => resolve({ _tag: "Success", value: undefined })),
        ),
    );
  await using screen = await render(
    <PullRequestReactionBar
      environmentId={EnvironmentId.make("test")}
      reference={{ projectId: ProjectId.make("project"), repository: "owner/repo", number: 1 }}
      reactions={[{ content: "thumbs-up", count: 1, viewerHasReacted: false, actors: ["other"] }]}
      canReact={true}
      onRefresh={() => {}}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "thumbs up, 1", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "thumbs up, 2", exact: true }));
  await userEvent.click(screen.getByRole("button", { name: "thumbs up, 1", exact: true }));
  const latest = screen.getByRole("button", { name: "thumbs up, 2", exact: true });
  await expect.element(latest).toHaveAttribute("aria-pressed", "true");

  await act(() => failFirst());
  await expect.element(latest).toHaveAttribute("aria-pressed", "true");
  await act(() => finishLater());
});
