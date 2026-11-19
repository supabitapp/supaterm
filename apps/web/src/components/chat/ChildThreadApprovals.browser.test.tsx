import type { ChildThreadApproval } from "@supaterm/client-runtime/state/thread-requests";
import { EnvironmentId, RuntimeRequestId, ThreadId } from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

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
const state = vi.hoisted(() => ({ respond: fake(), approvalsAtom: null as unknown }));

vi.mock("../../state/session", () => ({ useEnvironmentScope: () => true }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => state.respond }));
vi.mock("../../state/threads", () => ({
  childThreadApprovalsAtom: () => state.approvalsAtom,
  threadEnvironment: { respondToApproval: {} },
}));

import { ChildThreadApprovals } from "./ChildThreadApprovals";

function setup() {
  state.respond.reset();
  state.respond
    .implementOnce(async () =>
      AsyncResult.failure(Cause.fail(new Error("Child environment offline"))),
    )
    .implementOnce(async () => AsyncResult.success(undefined));
  const thread = {
    environmentId: EnvironmentId.make("child-env"),
    threadId: ThreadId.make("child"),
  };
  state.approvalsAtom = Atom.make<ReadonlyArray<ChildThreadApproval>>([
    {
      thread,
      title: "Compile task",
      approval: {
        requestId: RuntimeRequestId.make("approval"),
        requestKind: "command",
        detail: "Run compiler",
        createdAt: "2026-11-01T00:00:00.000Z",
        responseCapability: "live",
      },
    },
  ]);
  return thread;
}

it("shows a failed decision and clears the error when the user retries", async () => {
  const thread = setup();
  await using screen = await render(<ChildThreadApprovals threadRef={thread} />);
  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent("Child environment offline");
  await screen.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});
